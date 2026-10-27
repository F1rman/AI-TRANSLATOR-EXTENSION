import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest

from app.auth import DevelopmentTaskAuth, DevelopmentUserAuth
from app.config import Settings
from app.main import Runtime, create_app
from app.models import ApiError, TranslationRequest
from app.repository import MemoryRepository
from app.service import JobStore, TranslationService


class RecordingDispatcher:
    def __init__(self):
        self.calls = []
        self.fail = False

    async def enqueue(self, identifier, generation, kind="text"):
        self.calls.append((identifier, generation))
        if self.fail:
            raise ConnectionError("private transport information")


class FakeUpstream:
    def __init__(self):
        self.calls = []
        self.error = None

    async def translate(self, payload):
        self.calls.append(payload)
        if self.error:
            raise self.error
        return [{"id": segment["id"], "text": "translated: " + segment["text"]} for segment in payload["segments"]]


@pytest.fixture
def setup():
    clock = SimpleNamespace(now=datetime(2026, 10, 22, 12, 0, tzinfo=UTC))
    settings = Settings(mode="memory", allow_dev_auth=True, legacy_text_submission_enabled=True)
    repository = MemoryRepository()
    store = JobStore(repository, settings, lambda: clock.now)
    dispatcher, upstream = RecordingDispatcher(), FakeUpstream()
    service = TranslationService(store, dispatcher, upstream)
    runtime = Runtime(settings, service, DevelopmentUserAuth(), DevelopmentTaskAuth())
    return SimpleNamespace(clock=clock, settings=settings, repository=repository, store=store,
                           dispatcher=dispatcher, upstream=upstream, service=service, runtime=runtime)


def request(text="hello", key="test", **changes):
    values = {"sourceLanguage": "auto", "targetLanguage": "uk", "segments": [{"id": "first", "text": text}], "idempotencyKey": key}
    values.update(changes)
    return TranslationRequest(**values)


async def client_for(setup):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(setup.runtime)),
                             base_url="https://test", headers={"Authorization": "Bearer dev:alice"})


async def test_concurrent_idempotency_reserves_once_and_payload_conflict(setup):
    jobs = await asyncio.gather(*[setup.service.submit("alice", request()) for _ in range(12)])
    assert len({job["id"] for job in jobs}) == 1
    quota = await setup.store.get_quota("alice")
    assert quota["reservedWords"] == 1
    assert len(setup.repository.documents) == 3
    with pytest.raises(ApiError, match="IDEMPOTENCY_CONFLICT"):
        await setup.service.submit("alice", request("different"))
    assert (await setup.store.get_quota("alice"))["reservedWords"] == 1
    bob = await setup.service.submit("bob", request())
    assert bob["id"] != jobs[0]["id"]


async def test_atomic_two_job_limit(setup):
    outcomes = await asyncio.gather(*[setup.service.submit("alice", request(key=str(number))) for number in range(6)], return_exceptions=True)
    assert sum(isinstance(result, dict) for result in outcomes) == 2
    assert all(result.code == "CONCURRENCY_LIMIT" for result in outcomes if isinstance(result, ApiError))
    assert (await setup.store.get_quota("alice"))["reservedWords"] == 2


async def test_monthly_quota_counts_unicode_words_and_settles_success(setup):
    setup.store.settings = replace(setup.settings, limits=replace(setup.settings.limits, free=replace(setup.settings.limits.free, monthly_words=5)))
    job = await setup.service.submit("alice", request("Привіт, світе 👋 hello"))
    quota = await setup.store.get_quota("alice")
    assert quota["reservedWords"] == 3
    with pytest.raises(ApiError, match="QUOTA_EXCEEDED"):
        await setup.service.submit("alice", request("abc def ghi", key="second"))
    await setup.service.process(job["id"], 0)
    quota = await setup.store.get_quota("alice")
    assert (quota["usedWords"], quota["reservedWords"], quota["remainingWords"]) == (3, 0, 2)
    await setup.service.process(job["id"], 0)
    assert len(setup.upstream.calls) == 1
    assert (await setup.store.get_quota("alice"))["usedWords"] == 3


async def test_cancel_releases_once_and_late_completion_cannot_overwrite(setup):
    first = await setup.service.submit("alice", request())
    second = await setup.service.submit("alice", request("other", key="second"))
    claim = await setup.store.claim(first["id"], 0)
    assert (await setup.service.cancel("alice", first["id"]))["status"] == "cancelled"
    await setup.service.cancel("alice", first["id"])
    assert not await setup.store.finish(claim, translations=[{"id": "first", "text": "late"}])
    assert (await setup.store.get_quota("alice"))["reservedWords"] == 1
    assert (await setup.service.get("alice", first["id"]))["status"] == "cancelled"
    await setup.service.process(second["id"], 0)
    assert (await setup.store.get_quota("alice"))["usedWords"] == 1


async def test_failed_provider_releases_reservation_and_new_job_is_allowed(setup):
    setup.upstream.error = ApiError("UPSTREAM_RATE_LIMIT", "Provider busy", 429)
    job = await setup.service.submit("alice", request())
    await setup.service.process(job["id"], 0)
    result = await setup.service.get("alice", job["id"])
    assert result["status"] == "failed"
    assert result["error"]["code"] == "UPSTREAM_RATE_LIMIT"
    assert result["quota"]["remainingWords"] == 10_000
    assert "payload" not in result
    await setup.service.submit("alice", request(key="new"))


async def test_idempotency_ownership_and_read_cancel_isolation(setup):
    job = await setup.service.submit("alice", request())
    for operation in (setup.service.get, setup.service.cancel):
        with pytest.raises(ApiError, match="JOB_NOT_FOUND"):
            await operation("bob", job["id"])
    assert (await setup.store.get_quota("alice"))["reservedWords"] == 1


async def test_stale_worker_recovery_generation_and_lease_guards(setup):
    job = await setup.service.submit("alice", request())
    old_claim = await setup.store.claim(job["id"], 0)
    with pytest.raises(ApiError, match="SERVICE_UNAVAILABLE"):
        await setup.store.claim(job["id"], 0)
    setup.clock.now += timedelta(seconds=121)
    result = await setup.service.reconcile()
    assert result == {"scanned": 1, "dispatched": 1}
    assert setup.dispatcher.calls[-1] == (job["id"], 1)
    assert await setup.store.claim(job["id"], 0) is None
    new_claim = await setup.store.claim(job["id"], 1)
    assert not await setup.store.finish(old_claim, translations=[{"id": "first", "text": "stale"}])
    assert await setup.store.finish(new_claim, translations=[{"id": "first", "text": "fresh"}])
    assert (await setup.service.get("alice", job["id"]))["translations"][0]["text"] == "fresh"
    assert (await setup.store.get_quota("alice"))["usedWords"] == 1


async def test_enqueue_failure_reconciles_without_duplicate_quota(setup, caplog):
    setup.dispatcher.fail = True
    job = await setup.service.submit("alice", request("private source text"))
    assert job["status"] == "queued"
    assert "private source text" not in caplog.text
    assert "private transport information" not in caplog.text
    setup.dispatcher.fail = False
    assert (await setup.service.reconcile())["dispatched"] == 1
    retry = await setup.service.submit("alice", request("private source text"))
    assert retry["id"] == job["id"]
    assert (await setup.store.get_quota("alice"))["reservedWords"] == 3


async def test_lost_or_exhausted_queued_task_gets_new_generation(setup):
    job = await setup.service.submit("alice", request())
    setup.clock.now += timedelta(seconds=121)
    await setup.service.reconcile()
    assert setup.dispatcher.calls[-1] == (job["id"], 1)
    assert (await setup.store.get_quota("alice"))["reservedWords"] == 1


async def test_utc_month_rollover_settles_original_month(setup):
    setup.clock.now = datetime(2026, 10, 31, 23, 59, 59, tzinfo=UTC)
    job = await setup.service.submit("alice", request())
    setup.clock.now += timedelta(seconds=2)
    assert (await setup.store.get_quota("alice"))["remainingWords"] == 10_000
    await setup.service.process(job["id"], 0)
    account = await setup.repository.get(setup.store.user_key("alice"))
    assert account["monthlyUsage"]["2026-10"] == {"used": 1, "reserved": 0}
    assert (await setup.store.get_quota("alice"))["usedWords"] == 0


async def test_expired_and_ttl_deleted_jobs_release_concurrency_slots(setup):
    job = await setup.service.submit("alice", request())
    claim = await setup.store.claim(job["id"], 0)
    setup.clock.now += timedelta(days=1, seconds=1)
    assert await setup.store.finish(claim, translations=[{"id": "first", "text": "too late"}])
    with pytest.raises(ApiError, match="JOB_EXPIRED"):
        await setup.service.get("alice", job["id"])
    assert (await setup.store.get_quota("alice"))["usedWords"] == 0
    another = await setup.service.submit("alice", request(key="another"))
    del setup.repository.documents[setup.store.job_key(another["id"])]
    setup.clock.now += timedelta(days=1, seconds=1)
    assert (await setup.service.submit("alice", request(key="after-ttl")))["status"] == "queued"


async def test_api_round_trip_and_separate_worker_auth(setup):
    async with await client_for(setup) as client:
        me = await client.get("/v1/me")
        assert me.json()["limits"] == {"maxSegments": 24, "maxCharactersPerJob": 4000, "maxConcurrentJobs": 2}
        response = await client.post("/v1/translation-jobs", json=request().model_dump())
        assert response.status_code == 202
        identifier = response.json()["id"]
        refused = await client.post("/internal/process-job", json={"jobId": identifier})
        assert refused.status_code == 401
        worked = await client.post("/internal/process-job", json={"jobId": identifier, "generation": 0}, headers={"Authorization": "Bearer dev-task"})
        assert worked.status_code == 200
        complete = (await client.get(f"/v1/translation-jobs/{identifier}")).json()
        assert complete["status"] == "completed"
        assert complete["translations"] == [{"id": "first", "text": "translated: hello"}]
        assert complete["quota"]["usedWords"] == 1
        missing = await client.get("/v1/me", headers={"Authorization": ""})
        assert missing.status_code == 401
        assert missing.json()["error"]["code"] == "AUTH_REQUIRED"
        assert (await client.get("/health", headers={"Authorization": ""})).status_code == 200


@pytest.mark.parametrize("change", [
    {"sourceLanguage": " "}, {"targetLanguage": "auto"}, {"targetLanguage": "x" * 81},
    {"segments": [{"id": "1", "text": " "}]},
    {"segments": [{"id": "1", "text": "a"}, {"id": "1", "text": "b"}]},
    {"segments": [{"id": 1, "text": "a"}]},
    {"segments": [{"id": "1", "text": "x" * 4001}]},
    {"segments": [{"id": str(i), "text": "x"} for i in range(25)]},
    {"segments": [{"id": "1", "text": "x" * 3000}, {"id": "2", "text": "x" * 1001}]},
    {"prompt": "private source text"}, {"idempotencyKey": "contains space"},
])
async def test_schema_rejection_is_sanitized_and_costs_nothing(setup, change):
    payload = request("private source text").model_dump()
    payload.update(change)
    async with await client_for(setup) as client:
        response = await client.post("/v1/translation-jobs", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert "private source text" not in response.text
    assert not setup.dispatcher.calls
    assert not setup.upstream.calls


async def test_polling_after_completed_and_cancel_completed_are_idempotent(setup):
    job = await setup.service.submit("alice", request())
    await setup.service.process(job["id"])
    first = await setup.service.get("alice", job["id"])
    second = await setup.service.cancel("alice", job["id"])
    assert first == second
    assert len(setup.dispatcher.calls) == 1


async def test_arbitrary_language_names_are_trimmed_and_forwarded_as_data(setup):
    custom = request(sourceLanguage="  日本語  ", targetLanguage="  Українська  ")
    job = await setup.service.submit("alice", custom)
    await setup.service.process(job["id"])
    assert setup.upstream.calls[0]["sourceLanguage"] == "日本語"
    assert setup.upstream.calls[0]["targetLanguage"] == "Українська"


async def test_unknown_routes_and_methods_use_error_envelope(setup):
    async with await client_for(setup) as client:
        missing = await client.get("/unknown")
        method = await client.post("/health")
    assert missing.status_code == 404
    assert set(missing.json()) == {"error"}
    assert method.status_code == 405
    assert set(method.json()) == {"error"}
