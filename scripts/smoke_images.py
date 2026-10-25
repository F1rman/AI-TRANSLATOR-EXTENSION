#!/usr/bin/env python3
"""Run one paid image translation through the deployed durable worker with isolated fixtures.

Uses the explicitly selected gcloud administrator's short-lived access token only in memory.
It never creates a Firebase user token, impersonates an end user or uses a real user's quota.
Fixture artwork is local original material. All cloud fixture data is removed in finally.
"""
import argparse
import asyncio
from datetime import UTC, datetime, timedelta
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4

import httpx
from google.api_core.exceptions import NotFound
from google.cloud import storage, tasks_v2
from google.cloud.firestore_v1 import AsyncClient
from google.oauth2.credentials import Credentials

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import Settings
from app.dispatcher import CloudTasksDispatcher
from app.images import CloudImageStorage, validate_image
from app.models import ApiError, ImageTranslationRequest
from app.repository import FirestoreRepository
from app.service import JobStore, TranslationService, digest


class SmokeFailure(Exception):
    pass


def require(condition, code):
    if not condition:
        raise SmokeFailure(code)


def now():
    return datetime.now(UTC)


async def await_terminal(repository, identifier, timeout):
    started = time.monotonic()
    last_progress = -15
    while time.monotonic() - started < timeout:
        job = await repository.get(("translationJobs", identifier))
        elapsed = time.monotonic() - started
        if elapsed - last_progress >= 15:
            print(json.dumps({"stage": "waiting_for_live_image_worker", "elapsedSeconds": round(elapsed, 1),
                              "status": job.get("status") if job else "missing"}), flush=True)
            last_progress = elapsed
        if job and job["status"] in {"completed", "failed", "cancelled"}:
            return job
        await asyncio.sleep(2)
    raise SmokeFailure("IMAGE_WORKER_COMPLETION_TIMEOUT")


async def await_task_deleted(client, name, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            await client.get_task(request={"name": name}, retry=None, timeout=10)
        except NotFound:
            return
        await asyncio.sleep(1)
    raise SmokeFailure("TASK_ACKNOWLEDGEMENT_TIMEOUT")


async def run(args, report):
    token = subprocess.check_output(["gcloud", "auth", "print-access-token", "--account", args.account, "--quiet"],
                                    text=True, stderr=subprocess.DEVNULL).strip()
    require(bool(token), "GCLOUD_AUTH_UNAVAILABLE")
    credentials = Credentials(token=token, quota_project_id=args.project)
    settings = Settings(project_id=args.project, task_project=args.project, task_location=args.location,
                        task_queue=args.queue, backend_base_url=args.base_url, task_audience=args.base_url,
                        image_bucket=args.bucket,
                        task_service_account=f"ai-translator-tasks@{args.project}.iam.gserviceaccount.com")
    repository = FirestoreRepository.__new__(FirestoreRepository)
    repository.client = AsyncClient(project=args.project, credentials=credentials)
    dispatcher = CloudTasksDispatcher.__new__(CloudTasksDispatcher)
    dispatcher.settings = settings
    dispatcher.client = tasks_v2.CloudTasksAsyncClient(credentials=credentials)
    dispatcher.parent = dispatcher.client.queue_path(args.project, args.location, args.queue)
    images = CloudImageStorage.__new__(CloudImageStorage)
    images.client = storage.Client(project=args.project, credentials=credentials)
    images.bucket = images.client.bucket(args.bucket)
    store = JobStore(repository, settings)
    service = TranslationService(store, dispatcher, None, images)
    uid = "free-image-integration-smoke-" + uuid4().hex
    pro_uid = "pro-image-integration-smoke-" + uuid4().hex
    fixture_keys = {store.user_key(uid), store.entitlement_key(uid),
                    store.user_key(pro_uid), store.entitlement_key(pro_uid)}
    task_names, image_owners = set(), {}
    pro_limits, free_limits = settings.limits.pro, settings.limits.free
    data = Path(args.source).read_bytes()
    metadata = validate_image(data)
    image_hash = hashlib.sha256(data).hexdigest()
    report["source"] = {"path": str(Path(args.source).relative_to(ROOT)), **metadata,
                        "languages": ["English", "Ukrainian", "Arabic", "Japanese"], "targetLanguage": "English"}

    async def create(request_key, selected_store=store, selected_uid=uid):
        request = ImageTranslationRequest(sourceLanguage="auto", targetLanguage="English", idempotencyKey=request_key)
        candidate = uuid4().hex
        image_owners[candidate] = selected_uid
        fixture_keys.add(store.job_key(candidate))
        fixture_keys.add(("translationIdempotency", digest(selected_uid + "\0" + request_key)))
        object_key = f"jobs/{candidate}/original"
        await images.put(object_key, data, metadata["mimeType"])
        selected = await selected_store.create_image(selected_uid, request, candidate, metadata, image_hash, object_key)
        if selected != candidate:
            await images.delete_job(candidate)
        return selected

    async def enqueue(identifier, generation):
        name = dispatcher.client.task_path(args.project, args.location, args.queue, f"translate-{identifier}-{generation}")
        task_names.add(name)
        await dispatcher.enqueue(identifier, generation, kind="image")
        return name

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as http:
            health = await http.get(args.base_url + "/health")
            require(health.status_code == 200 and health.json() == {"status": "ok"}, "HEALTH_FAILED")
            report["checks"]["health"] = True
            for headers, expected in (({}, "AUTH_REQUIRED"), ({"Authorization": "Bearer invalid-smoke-token"}, "UNAUTHENTICATED")):
                response = await http.post(args.base_url + "/v1/image-translation-jobs", headers=headers,
                                           content=b"intentionally not multipart")
                require(response.status_code == 401 and response.json().get("error", {}).get("code") == expected,
                        "IMAGE_EARLY_AUTH_REJECTION_FAILED")
            report["checks"]["missingAndInvalidImageTokenRejectedBeforeParsing"] = True
            worker = await http.post(args.base_url + "/internal/process-job", json={"jobId": "0" * 32})
            require(worker.status_code == 401, "WORKER_AUTH_REJECTION_FAILED")
            report["checks"]["missingWorkerTokenRejected"] = True

        # A future recoverAt prevents scheduled reconciliation from starting a paid
        # operation while this separate Pro fixture verifies reservation/refund.
        pro_time = now() + timedelta(minutes=10)
        pro_store = JobStore(repository, settings, clock=lambda: pro_time)
        await repository.reference(store.entitlement_key(pro_uid)).set({"plan": "pro", "createdAt": now(), "source": "isolated-live-smoke"})
        pro_account = await pro_store.get_account(pro_uid)
        require(pro_account["plan"] == "pro" and pro_account["features"]["imageTranslation"],
                "FIXTURE_PRO_IMAGE_ACCESS_FAILED")
        require(pro_account["quota"]["monthlyWords"] == pro_limits.monthly_words
                and pro_account["imageQuota"]["monthlyImages"] == pro_limits.monthly_images,
                "FIXTURE_PRO_MONTHLY_LIMITS_FAILED")
        pro_id = await create(uuid4().hex, pro_store, pro_uid)
        pro_quota = await pro_store.get_image_quota(pro_uid)
        require(pro_quota["reservedImages"] == 1 and pro_quota["usedImages"] == 0
                and pro_quota["remainingImages"] == pro_limits.monthly_images - 1,
                "PRO_IMAGE_RESERVATION_FAILED")
        await pro_store.cancel(pro_uid, pro_id)
        await pro_store.cancel(pro_uid, pro_id)
        await images.delete_job(pro_id)
        pro_quota = await pro_store.get_image_quota(pro_uid)
        require(pro_quota["reservedImages"] == 0 and pro_quota["usedImages"] == 0
                and pro_quota["remainingImages"] == pro_limits.monthly_images,
                "PRO_IMAGE_CANCEL_REFUND_FAILED")
        report["proMonthlyWords"] = pro_limits.monthly_words
        report["proMonthlyImages"] = pro_limits.monthly_images
        report["checks"]["proImageAllowanceReservedAndRefundedWithoutProvider"] = True

        account = await store.get_account(uid)
        require(account["plan"] == "free" and account["features"]["imageTranslation"], "FIXTURE_FREE_IMAGE_ACCESS_FAILED")
        require(account["quota"]["monthlyWords"] == free_limits.monthly_words
                and account["imageQuota"]["monthlyImages"] == free_limits.monthly_images,
                "FIXTURE_FREE_MONTHLY_LIMITS_FAILED")
        report["paidFixturePlan"] = "free"
        report["monthlyWords"] = account["quota"]["monthlyWords"]
        report["monthlyImages"] = account["imageQuota"]["monthlyImages"]
        report["quotaResetsAt"] = account["imageQuota"]["resetsAt"]
        report["checks"]["isolatedFreeFixture"] = True
        request_key = uuid4().hex
        identifier = await create(request_key)
        quota = await store.get_image_quota(uid)
        require(quota["reservedImages"] == 1 and quota["usedImages"] == 0
                and quota["remainingImages"] == free_limits.monthly_images - 1, "IMAGE_RESERVATION_FAILED")
        report["checks"]["oneImageReserved"] = True
        original_job = await repository.get(store.job_key(identifier))
        async with httpx.AsyncClient(timeout=30) as http:
            original_access = await http.get(f"https://storage.googleapis.com/{args.bucket}/{original_job['input']['objectKey']}")
        require(original_access.status_code in {401, 403, 404}, "ORIGINAL_OBJECT_IS_PUBLIC")
        report["checks"]["anonymousOriginalDeniedWhileExists"] = True
        generation_zero_task = await enqueue(identifier, 0)
        await store.dispatched(identifier, 0)
        started = time.monotonic()
        completed = await await_terminal(repository, identifier, args.timeout)
        report["pipelineSeconds"] = round(time.monotonic() - started, 3)
        report["paidImageCallsRequested"] = 1
        if completed["status"] != "completed":
            report["workerErrorCode"] = completed.get("error", {}).get("code", "UNKNOWN")
            raise SmokeFailure("LIVE_IMAGE_WORKER_FAILED")
        require(completed.get("kind") == "image" and completed.get("output", {}).get("objectKey"), "IMAGE_OUTPUT_METADATA_MISSING")
        translated, mime = await service.image(uid, identifier, "translated")
        decoded = validate_image(translated, max_bytes=40 * 1024 * 1024, png_only=True)
        require(mime == "image/png" and all(completed["output"].get(key) == value for key, value in decoded.items()), "IMAGE_PNG_METADATA_INVALID")
        result = Path(args.result)
        result.parent.mkdir(parents=True, exist_ok=True)
        result.write_bytes(translated)
        report["result"] = {"path": str(result.relative_to(ROOT)), **decoded}
        report["checks"]["realCloudTaskOidcAndAiImageCompleted"] = True
        report["checks"]["freeImageAccessThroughCloudTasks"] = True
        report["checks"]["translatedPngSavedBeforeCleanup"] = True
        quota = await store.get_image_quota(uid)
        require(quota["usedImages"] == 1 and quota["reservedImages"] == 0
                and quota["remainingImages"] == free_limits.monthly_images - 1, "IMAGE_SETTLEMENT_FAILED")
        require((await store.get_quota(uid))["usedWords"] == 0, "IMAGE_SPENT_TEXT_QUOTA")
        report["checks"]["oneImageChargedWithoutTextCharge"] = True
        for operation in (lambda: service.get("other-fixture-user", identifier, kind="image"),
                          lambda: service.image("other-fixture-user", identifier, "translated")):
            try:
                await operation()
            except ApiError as error:
                require(error.code == "JOB_NOT_FOUND", "IMAGE_OWNER_GUARD_FAILED")
            else:
                raise SmokeFailure("IMAGE_OWNER_GUARD_FAILED")
        report["checks"]["ownerGuardOnStoredJobAndFile"] = True
        await asyncio.to_thread(images.bucket.reload)
        policy = await asyncio.to_thread(images.bucket.get_iam_policy, requested_policy_version=3)
        require(images.bucket.iam_configuration.uniform_bucket_level_access_enabled, "BUCKET_UNIFORM_ACCESS_DISABLED")
        require(images.bucket.iam_configuration.public_access_prevention == "enforced", "BUCKET_PUBLIC_ACCESS_PREVENTION_DISABLED")
        require(all(not ({"allUsers", "allAuthenticatedUsers"} & set(binding["members"])) for binding in policy.bindings), "BUCKET_HAS_PUBLIC_GRANT")
        async with httpx.AsyncClient(timeout=30) as http:
            public_image = await http.get(f"https://storage.googleapis.com/{args.bucket}/{completed['output']['objectKey']}")
            require(public_image.status_code in {401, 403, 404}, "RESULT_OBJECT_IS_PUBLIC")
        report["checks"]["privateStorageObject"] = True
        require(await create(request_key) == identifier, "IMAGE_IDEMPOTENCY_FAILED")
        require((await store.get_image_quota(uid))["usedImages"] == 1, "IMAGE_RETRY_CHARGED_TWICE")
        report["checks"]["sameKeySameImageDeduplicated"] = True
        duplicate_task = await enqueue(identifier, 1)
        await await_task_deleted(dispatcher.client, duplicate_task)
        require((await store.get_image_quota(uid))["usedImages"] == 1, "DUPLICATE_IMAGE_DELIVERY_CHARGED")
        report["checks"]["duplicateTerminalTaskAcknowledgedWithoutNewCharge"] = True
        await await_task_deleted(dispatcher.client, generation_zero_task)

        # Keep the recovery timestamp in the future so scheduled reconciliation cannot start a
        # second paid image call before we cancel this isolated cancellation fixture.
        future = now() + timedelta(minutes=10)
        cancellation_store = JobStore(repository, settings, clock=lambda: future)
        cancel_id = await create(uuid4().hex, cancellation_store)
        claim = await cancellation_store.claim(cancel_id, 0)
        require(claim is not None, "CANCEL_FIXTURE_CLAIM_FAILED")
        await cancellation_store.cancel(uid, cancel_id)
        await cancellation_store.cancel(uid, cancel_id)
        await images.delete_job(cancel_id)
        require(not await cancellation_store.finish(claim, output={"objectKey": "must-not-be-applied"}), "CANCELLED_IMAGE_ACCEPTED_LATE_COMPLETION")
        quota = await store.get_image_quota(uid)
        require(quota["usedImages"] == 1 and quota["reservedImages"] == 0, "IMAGE_CANCEL_REFUND_FAILED")
        cancelled_task = await enqueue(cancel_id, 0)
        await await_task_deleted(dispatcher.client, cancelled_task)
        require((await repository.get(store.job_key(cancel_id)))["status"] == "cancelled", "LATE_IMAGE_TASK_OVERWROTE_CANCEL")
        report["checks"]["cancelReservationRefundedOnce"] = True
        report["checks"]["lateCompletionRejectedAfterManualLeaseCancellation"] = True
        report["checks"]["cancelledTaskAcknowledgedWithoutProviderWork"] = True
        report["cancellationMethod"] = "Separate future-recovery fixture, manual lease, cancel before provider, stale finish rejected, real terminal task acknowledged."
        report["chargedImages"] = 1
    finally:
        cleanup_ok = True
        for name in task_names:
            try:
                await dispatcher.client.delete_task(request={"name": name}, retry=None, timeout=10)
            except NotFound:
                pass
            except Exception:
                cleanup_ok = False
        # Disable all fixture work before deleting source objects and account/entitlement records.
        for image_id, owner_uid in image_owners.items():
            try:
                existing = await repository.get(store.job_key(image_id))
                if existing and existing["status"] not in {"completed", "failed", "cancelled"}:
                    await store.cancel(owner_uid, image_id)
                await images.delete_job(image_id)
            except Exception:
                cleanup_ok = False
        try:
            batch = repository.client.batch()
            for fixture_key in fixture_keys:
                batch.delete(repository.reference(fixture_key))
            await batch.commit(timeout=30)
        except Exception:
            cleanup_ok = False
        report["checks"]["allCloudFixturesCleaned"] = cleanup_ok
        await dispatcher.close()
        await images.close()
        await repository.close()
        require(cleanup_ok, "IMAGE_FIXTURE_CLEANUP_FAILED")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="https://ai-translator-api-1060412514800.europe-west1.run.app")
    parser.add_argument("--project", default="ai-translator-ext")
    parser.add_argument("--location", default="europe-west1")
    parser.add_argument("--queue", default="translation-jobs")
    parser.add_argument("--bucket", default="ai-translator-ext-images")
    parser.add_argument("--account", default="balubenko.ink@gmail.com")
    parser.add_argument("--source", default=str(ROOT / "artifacts/image-fixture/original.png"))
    parser.add_argument("--result", default=str(ROOT / "artifacts/image-fixture/translated-1.1.2.png"))
    parser.add_argument("--output", default=str(ROOT / "artifacts/image-smoke-1.1.2.json"))
    parser.add_argument("--timeout", type=int, default=400)
    args = parser.parse_args()
    args.base_url = args.base_url.rstrip("/")
    report = {"project": args.project, "baseUrl": args.base_url, "startedAt": now().isoformat(), "success": False,
              "liveGoogleLoginTested": False, "userAuthenticationMode": "isolated administrator-owned Firestore fixture; no Firebase end-user tokens",
              "developerAccountQuotaConsumed": False, "semanticVisualReviewRequired": True, "checks": {}}
    try:
        require(args.base_url.startswith("https://"), "HTTPS_REQUIRED")
        asyncio.run(run(args, report))
        report["success"] = True
        report["pipelineSuccess"] = True
    except SmokeFailure as error:
        report["failureCode"] = str(error)
    except Exception as error:
        # Transport/provider exception text may contain credentials or request payloads.
        report["failureCode"] = "UNEXPECTED_" + type(error).__name__.upper()
    report["finishedAt"] = now().isoformat()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
