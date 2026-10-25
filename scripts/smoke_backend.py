#!/usr/bin/env python3
"""Exercise the deployed private worker using isolated Firestore fixtures.

Run with backend/.venv/bin/python scripts/smoke_backend.py --base-url HTTPS_URL.
The short-lived gcloud token stays in memory and is never included in output.
This makes one tiny paid translation request and removes its fixture documents.
"""
import argparse
import asyncio
from datetime import UTC, datetime
import json
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4

import httpx
from google.api_core.exceptions import NotFound
from google.cloud import tasks_v2
from google.cloud.firestore_v1 import AsyncClient
from google.oauth2.credentials import Credentials

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import Settings
from app.dispatcher import CloudTasksDispatcher
from app.models import TranslationRequest
from app.repository import FirestoreRepository
from app.service import JobStore, digest
from app.words import count_words


def now():
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def require(condition, code):
    if not condition:
        raise SmokeFailure(code)


class SmokeFailure(Exception):
    pass


async def wait_for_job(repository, identifier, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = await repository.get(("translationJobs", identifier))
        if job and job["status"] in {"completed", "failed", "cancelled"}:
            return job
        await asyncio.sleep(2)
    raise SmokeFailure("WORKER_COMPLETION_TIMEOUT")


async def wait_for_task_deletion(client, name, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            await client.get_task(request={"name": name}, retry=None, timeout=10)
        except NotFound:
            return
        await asyncio.sleep(1)
    raise SmokeFailure("TASK_ACKNOWLEDGEMENT_TIMEOUT")


async def run(args, report):
    token = subprocess.check_output(["gcloud", "auth", "print-access-token", "--quiet"],
                                    text=True, stderr=subprocess.DEVNULL).strip()
    require(bool(token), "GCLOUD_AUTH_UNAVAILABLE")
    credentials = Credentials(token=token, quota_project_id=args.project)
    settings = Settings(
        project_id=args.project, task_project=args.project, task_location=args.location,
        task_queue=args.queue, backend_base_url=args.base_url, task_audience=args.audience or args.base_url,
        task_service_account=args.task_service_account or f"ai-translator-tasks@{args.project}.iam.gserviceaccount.com",
    )
    repository = FirestoreRepository.__new__(FirestoreRepository)
    repository.client = AsyncClient(project=args.project, credentials=credentials)
    dispatcher = CloudTasksDispatcher.__new__(CloudTasksDispatcher)
    dispatcher.settings = settings
    dispatcher.client = tasks_v2.CloudTasksAsyncClient(credentials=credentials)
    dispatcher.parent = dispatcher.client.queue_path(args.project, args.location, args.queue)
    store = JobStore(repository, settings)
    word_limit = settings.limits.free.monthly_words
    uid = "integration-smoke-" + uuid4().hex
    fixture_keys = {store.user_key(uid)}
    task_names = set()

    async def enqueue(identifier, generation):
        task_names.add(dispatcher.client.task_path(args.project, args.location, args.queue,
                                                 f"translate-{identifier}-{generation}"))
        await dispatcher.enqueue(identifier, generation)

    async def create(key, text):
        request = TranslationRequest(sourceLanguage="English", targetLanguage="Ukrainian",
                                     segments=[{"id": "smoke-text", "text": text}], idempotencyKey=key)
        identifier = await store.create(uid, request)
        fixture_keys.add(store.job_key(identifier))
        fixture_keys.add(("translationIdempotency", digest(uid + "\0" + key)))
        return identifier

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as http:
            health = await http.get(args.base_url + "/health")
            require(health.status_code == 200 and health.json() == {"status": "ok"}, "HEALTH_FAILED")
            report["checks"]["health"] = True
            unauthenticated = await http.get(args.base_url + "/v1/me")
            require(unauthenticated.status_code == 401 and unauthenticated.json().get("error", {}).get("code") == "AUTH_REQUIRED", "PUBLIC_AUTH_REJECTION_FAILED")
            report["checks"]["missingUserTokenRejected"] = True
            invalid = await http.get(args.base_url + "/v1/me", headers={"Authorization": "Bearer invalid-smoke-token"})
            require(invalid.status_code == 401 and invalid.json().get("error", {}).get("code") == "UNAUTHENTICATED", "INVALID_USER_TOKEN_REJECTION_FAILED")
            report["checks"]["invalidUserTokenRejected"] = True
            worker = await http.post(args.base_url + "/internal/process-job", json={"jobId": "0" * 32})
            require(worker.status_code == 401, "WORKER_AUTH_REJECTION_FAILED")
            report["checks"]["missingWorkerTokenRejected"] = True

        text, key = "Hello, world!", uuid4().hex
        require(count_words(text) == 2, "FIXTURE_WORD_COUNT_FAILED")
        identifier = await create(key, text)
        quota = await store.get_quota(uid)
        require(quota["monthlyWords"] == word_limit and quota["reservedWords"] == 2
                and quota["usedWords"] == 0 and quota["remainingWords"] == word_limit - 2, "INITIAL_RESERVATION_FAILED")
        report["monthlyWords"] = quota["monthlyWords"]
        report["quotaResetsAt"] = quota["resetsAt"]
        report["checks"]["quotaReserved"] = True
        await enqueue(identifier, 0)
        await store.dispatched(identifier, 0)
        job = await wait_for_job(repository, identifier, args.timeout)
        if job["status"] != "completed":
            report["workerErrorCode"] = job.get("error", {}).get("code", "UNKNOWN")
            raise SmokeFailure("WORKER_TRANSLATION_FAILED")
        translated = job.get("translations", [])
        require(len(translated) == 1 and translated[0].get("id") == "smoke-text"
                and isinstance(translated[0].get("text"), str)
                and any("\u0400" <= character <= "\u04ff" for character in translated[0]["text"]), "TRANSLATION_MAPPING_FAILED")
        report["checks"]["realTaskOidcWorkerCompleted"] = True
        quota = await store.get_quota(uid)
        require(quota["usedWords"] == 2 and quota["reservedWords"] == 0
                and quota["remainingWords"] == word_limit - 2, "QUOTA_SETTLEMENT_FAILED")
        report["checks"]["quotaChargedOnce"] = True
        require(await create(key, text) == identifier, "LIVE_IDEMPOTENCY_FAILED")
        report["checks"]["liveIdempotency"] = True

        # A separate delivery must reach the real worker and acknowledge a terminal job without charging again.
        await enqueue(identifier, 1)
        duplicate_task = dispatcher.client.task_path(args.project, args.location, args.queue,
                                                   f"translate-{identifier}-1")
        await wait_for_task_deletion(dispatcher.client, duplicate_task)
        require((await store.get_quota(uid))["usedWords"] == 2, "DUPLICATE_DELIVERY_CHARGED")
        report["checks"]["duplicateDeliveryDidNotCharge"] = True

        cancelled = await create(uuid4().hex, "Cancel me")
        require(count_words("Cancel me") == 2, "CANCELLATION_FIXTURE_WORD_COUNT_FAILED")
        require((await store.get_quota(uid))["reservedWords"] == 2, "CANCELLATION_RESERVATION_FAILED")
        await store.cancel(uid, cancelled)
        await store.cancel(uid, cancelled)
        quota = await store.get_quota(uid)
        require(quota["reservedWords"] == 0 and quota["usedWords"] == 2, "CANCELLATION_RELEASE_FAILED")
        await enqueue(cancelled, 0)
        cancelled_task = dispatcher.client.task_path(args.project, args.location, args.queue,
                                                   f"translate-{cancelled}-0")
        await wait_for_task_deletion(dispatcher.client, cancelled_task)
        require((await repository.get(store.job_key(cancelled)))["status"] == "cancelled", "LATE_TASK_OVERWROTE_CANCELLATION")
        require((await store.get_quota(uid))["usedWords"] == 2, "CANCELLED_JOB_CHARGED")
        report["checks"]["cancellationReleasedOnceAndLateDeliveryIgnored"] = True
        report["chargedWords"] = 2
    finally:
        cleanup_ok = True
        for name in task_names:
            try:
                await dispatcher.client.delete_task(request={"name": name}, retry=None, timeout=10)
            except NotFound:
                pass
            except Exception:
                cleanup_ok = False
        try:
            batch = repository.client.batch()
            for fixture_key in fixture_keys:
                batch.delete(repository.reference(fixture_key))
            await batch.commit(timeout=20)
        except Exception:
            cleanup_ok = False
        report["checks"]["fixturesCleaned"] = cleanup_ok
        await dispatcher.close()
        await repository.close()
        require(cleanup_ok, "FIXTURE_CLEANUP_FAILED")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--project", default="ai-translator-ext")
    parser.add_argument("--location", default="europe-west1")
    parser.add_argument("--queue", default="translation-jobs")
    parser.add_argument("--task-service-account")
    parser.add_argument("--audience")
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--output", default=str(ROOT / "artifacts" / "backend-smoke-1.1.2.json"))
    args = parser.parse_args()
    args.base_url = args.base_url.rstrip("/")
    require(args.base_url.startswith("https://"), "HTTPS_REQUIRED")
    report = {"project": args.project, "baseUrl": args.base_url, "startedAt": now(), "success": False, "checks": {}}
    try:
        asyncio.run(run(args, report))
        report["success"] = True
    except SmokeFailure as error:
        report["failureCode"] = str(error)
    except Exception as error:
        # Do not serialize transport exceptions: they can contain request metadata.
        report["failureCode"] = "UNEXPECTED_" + type(error).__name__.upper()
    report["finishedAt"] = now()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
