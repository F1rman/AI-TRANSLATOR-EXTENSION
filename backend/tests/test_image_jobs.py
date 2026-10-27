import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

from PIL import Image
import httpx
import pytest

from app.auth import DevelopmentTaskAuth, DevelopmentUserAuth
from app.config import Settings
from app.images import MemoryImageStorage, validate_image
from app.main import Runtime, create_app
from app.models import ApiError, ImageTranslationRequest, SubscriptionSync, TranslationRequest
from app.repository import MemoryRepository
from app.service import JobStore, TranslationService


def png(format="PNG", size=(40, 20)):
    out = BytesIO()
    Image.new("RGB", size, "white").save(out, format=format)
    return out.getvalue()


def image_request(key="image", **changes):
    return ImageTranslationRequest(**{"sourceLanguage": "auto", "targetLanguage": "uk", "idempotencyKey": key, **changes})


class CountingRepository(MemoryRepository):
    def __init__(self):
        super().__init__()
        self.reads, self.transactions = [], 0

    async def get(self, key):
        self.reads.append(key)
        return await super().get(key)

    async def atomic(self, keys, operation, **options):
        self.transactions += 1
        return await super().atomic(keys, operation, **options)


class Dispatcher:
    def __init__(self):
        self.calls = []

    async def enqueue(self, identifier, generation, kind="text"):
        self.calls.append((identifier, generation, kind))


class Upstream:
    def __init__(self):
        self.image_calls, self.text_calls = [], []
        self.result, self.error = png(), None
        self.started, self.release = None, None

    async def translate(self, payload):
        self.text_calls.append(payload)
        return [{"id": segment["id"], "text": "translation"} for segment in payload["segments"]]

    async def translate_image(self, data, mime, payload):
        self.image_calls.append((data, mime, payload))
        if self.started:
            self.started.set()
            await self.release.wait()
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def setup():
    clock = SimpleNamespace(now=datetime(2026, 10, 24, 12, tzinfo=UTC))
    settings = Settings(mode="memory", allow_dev_auth=True)
    repository, images, upstream, dispatcher = CountingRepository(), MemoryImageStorage(), Upstream(), Dispatcher()
    store = JobStore(repository, settings, lambda: clock.now)
    service = TranslationService(store, dispatcher, upstream, images)
    runtime = Runtime(settings, service, DevelopmentUserAuth(), DevelopmentTaskAuth())
    return SimpleNamespace(clock=clock, settings=settings, repository=repository, images=images, upstream=upstream,
                           dispatcher=dispatcher, store=store, service=service, runtime=runtime)


def grant(setup, uid="alice", plan="pro"):
    setup.repository.documents[setup.store.entitlement_key(uid)] = {"plan": plan}


def disable_free_images(setup):
    settings = setup.store.settings
    setup.store.settings = replace(settings, limits=replace(settings.limits,
        free=replace(settings.limits.free, monthly_images=0)))


def client(setup, uid="alice"):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(setup.runtime)),
                            base_url="https://test", headers={"Authorization": f"Bearer dev:{uid}"})


async def test_paid_text_subscription_does_not_grant_legacy_pro_image_allowance(setup):
    setup.store.settings = replace(setup.settings, project_id="ai-translator-ext")
    start = int(setup.clock.now.timestamp())
    await setup.store.sync_subscription(SubscriptionSync(
        environment="live", productId="ai-translator-extension", authProjectId="ai-translator-ext",
        uid="alice", revision=1, subscriptionId="sub_paid_text", status="active", blockedReason=None,
        paidPeriodStart=start, paidThrough=start + 31 * 86400, quotaAnchorAt=start, policyVersion=2))
    async with client(setup) as api:
        account = (await api.get("/v1/me")).json()
        assert account["plan"] == "pro"
        assert account["imageQuota"]["monthlyImages"] == 5
    setup.repository.documents[setup.store.user_key("alice")] = {
        "monthlyImageUsage": {"2026-10": {"used": 5, "reserved": 0}}}
    with pytest.raises(ApiError, match="IMAGE_QUOTA_EXCEEDED"):
        await setup.service.submit_image("alice", image_request(), png())
    assert setup.upstream.image_calls == []
    grant(setup)
    assert (await setup.store.get_account("alice"))["imageQuota"]["monthlyImages"] == 150


async def test_default_free_and_server_owned_entitlement(setup):
    async with client(setup) as api:
        me = (await api.get("/v1/me")).json()
        assert me["plan"] == "free" and me["features"] == {"imageTranslation": True}
        assert me["quota"]["monthlyWords"] == 10_000
        assert me["imageQuota"]["monthlyImages"] == 5
        result = await api.post("/v1/image-translation-jobs", files={"file": ("pic.png", png(), "image/png")},
                                data=image_request().model_dump())
        assert result.status_code == 202
        await setup.service.process(result.json()["id"], 0)
        assert len(setup.upstream.image_calls) == 1
        grant(setup)
        pro = (await api.get("/v1/me")).json()
        assert pro["features"]["imageTranslation"] is True
        assert pro["plan"] == "pro" and pro["quota"]["monthlyWords"] == 200_000
        assert pro["imageQuota"]["monthlyImages"] == 150
        # There is no public plan setter.
        assert (await api.post("/v1/me", json={"plan": "pro"})).status_code == 405


async def test_free_can_translate_five_images_then_sixth_is_rejected(setup):
    for index in range(5):
        job = await setup.service.submit_image("alice", image_request(str(index)), png())
        assert job["imageQuota"]["monthlyImages"] == 5
        await setup.service.process(job["id"], 0)
        quota = await setup.store.get_image_quota("alice")
        assert quota["usedImages"] == index + 1
        assert quota["remainingImages"] == 4 - index
    with pytest.raises(ApiError, match="IMAGE_QUOTA_EXCEEDED"):
        await setup.service.submit_image("alice", image_request("sixth"), png())
    assert len(setup.upstream.image_calls) == 5
    assert len(setup.images.objects) == 10  # only the five completed originals/results


async def test_free_zero_configuration_disables_feature_and_denies_direct_reservation(setup):
    disable_free_images(setup)
    account = await setup.store.get_account("alice")
    assert account["features"] == {"imageTranslation": False}
    assert account["imageQuota"]["monthlyImages"] == 0
    with pytest.raises(ApiError, match="PRO_REQUIRED"):
        await setup.service.submit_image("alice", image_request(), png())
    with pytest.raises(ApiError, match="PRO_REQUIRED"):
        await setup.store.create_image("alice", image_request(), "a" * 32, {}, "digest", "object-key")
    assert not setup.images.objects and not setup.upstream.image_calls
    assert not setup.repository.documents


@pytest.mark.parametrize("used,expected", [(4, "completed"), (5, "failed")])
@pytest.mark.parametrize("during_download", [False, True])
async def test_downgraded_pro_uses_free_quota_before_provider(setup, used, expected, during_download):
    grant(setup)
    setup.repository.documents[setup.store.user_key("alice")] = {
        "monthlyImageUsage": {"2026-10": {"used": used, "reserved": 0}}, "activeJobs": {}}
    job = await setup.service.submit_image("alice", image_request(), png())
    if during_download:
        original_get = setup.images.get
        async def downgrade_while_loading(key):
            result = await original_get(key)
            setup.repository.documents.pop(setup.store.entitlement_key("alice"))
            return result
        setup.images.get = downgrade_while_loading
    else:
        grant(setup, plan="free")
    await setup.service.process(job["id"], 0)
    result = await setup.service.get("alice", job["id"], kind="image")
    assert result["status"] == expected
    assert result["imageQuota"]["monthlyImages"] == 5
    assert result["imageQuota"]["reservedImages"] == 0
    if expected == "completed":
        assert len(setup.upstream.image_calls) == 1
        assert result["imageQuota"]["usedImages"] == 5
    else:
        assert result["error"]["code"] == "IMAGE_QUOTA_EXCEEDED"
        assert not setup.upstream.image_calls and not setup.images.objects
        assert result["imageQuota"]["usedImages"] == 5


async def test_image_success_owner_only_files_and_no_bytes_in_firestore(setup):
    grant(setup)
    async with client(setup) as api:
        submitted = await api.post("/v1/image-translation-jobs", files={"file": ("untrusted.svg", png(), "text/plain")},
                                   data=image_request().model_dump())
        assert submitted.status_code == 202
        job = submitted.json()
        assert job["kind"] == "image" and job["imageQuota"]["reservedImages"] == 1
        assert setup.dispatcher.calls == [(job["id"], 0, "image")]
        base = f"/v1/image-translation-jobs/{job['id']}"
        assert (await api.get(base + "/image?variant=original")).content == png()
        assert (await api.get(base + "/image")).status_code == 409
        await setup.service.process(job["id"], 0)
        completed = (await api.get(base)).json()
        assert completed["status"] == "completed"
        assert completed["output"] == {"mimeType": "image/png", "width": 40, "height": 20, "bytes": len(png())}
        assert completed["imageQuota"]["usedImages"] == 1
        image = await api.get(base + "/image")
        assert image.content == png() and image.headers["content-type"] == "image/png"
        assert image.headers["cache-control"] == "no-store"
        for method, path in (("GET", base), ("DELETE", base), ("GET", base + "/image?variant=original"), ("GET", base + "/image")):
            denied = await api.request(method, path, headers={"Authorization": "Bearer dev:bob"})
            assert denied.status_code == 404
        assert (await api.get(f"/v1/translation-jobs/{job['id']}")).status_code == 404
    assert "objectKey" not in str(completed)
    assert all(not isinstance(value, bytes) for doc in setup.repository.documents.values() for value in doc.values())
    assert (await setup.store.get_quota("alice"))["usedWords"] == 0


async def test_concurrent_image_retries_reserve_once_cleanup_orphans_and_conflict(setup):
    grant(setup)
    outcomes = await asyncio.gather(*[setup.service.submit_image("alice", image_request(), png()) for _ in range(10)])
    assert len({job["id"] for job in outcomes}) == 1
    assert len(setup.images.objects) == 1
    assert (await setup.store.get_image_quota("alice"))["reservedImages"] == 1
    with pytest.raises(ApiError, match="IDEMPOTENCY_CONFLICT"):
        await setup.service.submit_image("alice", image_request(targetLanguage="fr"), png())
    with pytest.raises(ApiError, match="IDEMPOTENCY_CONFLICT"):
        await setup.service.submit_image("alice", image_request(), png(size=(41, 20)))
    assert len(setup.images.objects) == 1


async def test_image_single_job_and_global_two_job_limit_atomic(setup):
    grant(setup)
    results = await asyncio.gather(*[setup.service.submit_image("alice", image_request(str(i)), png()) for i in range(5)], return_exceptions=True)
    assert sum(isinstance(value, dict) for value in results) == 1
    assert all(value.code == "CONCURRENCY_LIMIT" for value in results if isinstance(value, ApiError))
    text = TranslationRequest(sourceLanguage="auto", targetLanguage="uk", idempotencyKey="text", segments=[{"id": "1", "text": "x"}])
    await setup.service.submit("alice", text)
    text.idempotencyKey = "other"
    with pytest.raises(ApiError, match="CONCURRENCY_LIMIT"):
        await setup.service.submit("alice", text)
    assert len(setup.images.objects) == 1


async def test_monthly_image_quota_success_refund_and_rollover(setup):
    grant(setup)
    # Seed previous successes rather than issuing 150 identical mock operations.
    setup.repository.documents[setup.store.user_key("alice")] = {
        "monthlyImageUsage": {"2026-10": {"used": 145, "reserved": 0}}, "activeJobs": {}}
    for i in range(5):
        job = await setup.service.submit_image("alice", image_request(str(i)), png())
        await setup.service.process(job["id"], 0)
    assert (await setup.store.get_image_quota("alice"))["usedImages"] == 150
    with pytest.raises(ApiError, match="IMAGE_QUOTA_EXCEEDED"):
        await setup.service.submit_image("alice", image_request("six"), png())
    setup.clock.now = datetime(2026, 11, 30, 23, 59, 59, tzinfo=UTC)
    crossing = await setup.service.submit_image("alice", image_request("crossing"), png())
    setup.clock.now += timedelta(seconds=2)
    await setup.service.process(crossing["id"], 0)
    account = await setup.repository.get(setup.store.user_key("alice"))
    assert account["monthlyImageUsage"]["2026-11"] == {"used": 1, "reserved": 0}
    assert (await setup.store.get_image_quota("alice"))["remainingImages"] == 150


async def test_monthly_image_quota_last_slot_is_atomic_and_does_not_reset_daily(setup):
    grant(setup)
    setup.repository.documents[setup.store.user_key("alice")] = {
        "monthlyImageUsage": {"2026-10": {"used": 149, "reserved": 0}}, "activeJobs": {}}
    results = await asyncio.gather(*[setup.service.submit_image("alice", image_request(str(i)), png())
                                     for i in range(10)], return_exceptions=True)
    jobs = [result for result in results if isinstance(result, dict)]
    assert len(jobs) == 1
    assert all(result.code == "IMAGE_QUOTA_EXCEEDED" for result in results if isinstance(result, ApiError))
    assert len(setup.images.objects) == 1
    await setup.service.process(jobs[0]["id"], 0)
    setup.clock.now += timedelta(days=1)
    quota = await setup.store.get_image_quota("alice")
    assert quota["remainingImages"] == 0 and quota["resetsAt"] == "2026-11-01T00:00:00Z"


async def test_revoked_pro_before_worker_blocks_provider_and_refunds(setup):
    disable_free_images(setup)
    grant(setup)
    job = await setup.service.submit_image("alice", image_request(), png())
    grant(setup, plan="free")
    await setup.service.process(job["id"], 0)
    result = await setup.service.get("alice", job["id"], kind="image")
    assert result["status"] == "failed" and result["error"]["code"] == "PRO_REQUIRED"
    assert result["imageQuota"]["reservedImages"] == 0
    assert not setup.upstream.image_calls and not setup.images.objects


async def test_cancel_running_image_refunds_and_discards_late_result(setup):
    grant(setup)
    setup.upstream.started, setup.upstream.release = asyncio.Event(), asyncio.Event()
    job = await setup.service.submit_image("alice", image_request(), png())
    running = asyncio.create_task(setup.service.process(job["id"], 0))
    await setup.upstream.started.wait()
    cancelled = await setup.service.cancel("alice", job["id"], kind="image")
    assert cancelled["status"] == "cancelled" and cancelled["imageQuota"]["remainingImages"] == 150
    assert not setup.images.objects
    setup.upstream.release.set()
    await running
    assert not setup.images.objects
    assert (await setup.service.get("alice", job["id"], kind="image"))["status"] == "cancelled"


@pytest.mark.parametrize("result,error,expected", [(b"invalid provider data", None, "INVALID_TRANSLATION"),
    (None, ApiError("UPSTREAM_TIMEOUT", "Timed out", 504), "UPSTREAM_TIMEOUT"),
    (None, RuntimeError("private upstream detail"), "UPSTREAM_UNAVAILABLE")])
async def test_image_provider_errors_release_and_delete(setup, result, error, expected, caplog):
    grant(setup)
    setup.upstream.result, setup.upstream.error = result, error
    job = await setup.service.submit_image("alice", image_request(), png())
    await setup.service.process(job["id"], 0)
    response = await setup.service.get("alice", job["id"], kind="image")
    assert response["error"]["code"] == expected
    assert response["imageQuota"]["remainingImages"] == 150 and not setup.images.objects
    assert "private upstream detail" not in caplog.text


@pytest.mark.parametrize("data", [b"", b"<svg>unsafe</svg>", b"broken-image", png("GIF"), png()[:55], b"x" * (10 * 1024 * 1024 + 1)])
async def test_invalid_image_never_reserves_or_calls_provider(setup, data):
    grant(setup)
    with pytest.raises(ApiError, match="INVALID_IMAGE"):
        await setup.service.submit_image("alice", image_request(), data)
    assert not setup.images.objects and not setup.dispatcher.calls and not setup.upstream.image_calls
    assert (await setup.store.get_image_quota("alice"))["remainingImages"] == 150


def test_image_pixel_and_animation_validation():
    with pytest.raises(ApiError, match="INVALID_IMAGE"):
        validate_image(png(size=(100, 100)), max_pixels=9999)
    out = BytesIO()
    Image.new("RGB", (10, 10), "red").save(out, format="PNG", save_all=True, append_images=[Image.new("RGB", (10, 10), "blue")])
    with pytest.raises(ApiError, match="INVALID_IMAGE"):
        validate_image(out.getvalue())
    assert validate_image(png("JPEG"))["mimeType"] == "image/jpeg"
    assert validate_image(png("WEBP"))["mimeType"] == "image/webp"


async def test_ordinary_legacy_poll_reads_account_manual_and_paid_access_without_transactions(setup):
    grant(setup)
    text = TranslationRequest(sourceLanguage="auto", targetLanguage="uk", idempotencyKey="text", segments=[{"id": "1", "text": "hello"}])
    text_job = await setup.service.submit("alice", text)
    image_job = await setup.service.submit_image("alice", image_request(), png())
    for job, kind in ((text_job, "text"), (image_job, "image")):
        setup.repository.reads.clear()
        before = setup.repository.transactions
        await setup.service.get("alice", job["id"], kind=kind)
        assert setup.repository.reads == [setup.store.job_key(job["id"]), setup.store.user_key("alice"),
                                          setup.store.entitlement_key("alice"), setup.store.subscription_key("alice")]
        assert setup.repository.transactions == before
    setup.clock.now += timedelta(seconds=121)
    await setup.service.get("alice", text_job["id"])
    assert setup.dispatcher.calls[-1] == (text_job["id"], 1, "text")


async def test_image_lease_uses_ten_minutes_before_recovery(setup):
    grant(setup)
    job = await setup.service.submit_image("alice", image_request(), png())
    claim = await setup.store.claim(job["id"], 0)
    setup.clock.now += timedelta(seconds=121)
    assert (await setup.service.reconcile())["dispatched"] == 0
    setup.clock.now += timedelta(seconds=480)
    assert (await setup.service.reconcile())["dispatched"] == 1
    assert setup.dispatcher.calls[-1] == (job["id"], 1, "image")
    assert not await setup.store.finish(claim, output={})


async def test_chunked_upload_size_is_limited_before_form_spooling(setup):
    grant(setup)
    async def chunks():
        yield b'--bound\r\nContent-Disposition: form-data; name="file"; filename="pic.png"\r\nContent-Type: image/png\r\n\r\n'
        for _ in range(11):
            yield b"x" * (1024 * 1024)
        yield b"\r\n--bound--\r\n"
    async with client(setup) as api:
        response = await api.post("/v1/image-translation-jobs", content=chunks(),
                                  headers={"Content-Type": "multipart/form-data; boundary=bound"})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "INVALID_IMAGE"
    assert not setup.images.objects


async def test_entitlement_is_rechecked_after_storage_read_and_before_paid_call(setup):
    disable_free_images(setup)
    grant(setup)
    job = await setup.service.submit_image("alice", image_request(), png())
    original_get = setup.images.get
    async def revoke_while_loading(key):
        result = await original_get(key)
        grant(setup, plan="free")
        return result
    setup.images.get = revoke_while_loading
    await setup.service.process(job["id"], 0)
    assert not setup.upstream.image_calls and not setup.images.objects
    assert (await setup.store.get_image_quota("alice"))["reservedImages"] == 0


async def test_partially_successful_upload_failure_cleans_unreserved_object(setup):
    grant(setup)
    original_put = setup.images.put
    async def fail_after_upload(*args):
        await original_put(*args)
        raise ConnectionError("connection lost after write")
    setup.images.put = fail_after_upload
    with pytest.raises(ConnectionError):
        await setup.service.submit_image("alice", image_request(), png())
    assert not setup.images.objects
    assert (await setup.store.get_image_quota("alice"))["reservedImages"] == 0
    assert not setup.dispatcher.calls


async def test_expiry_cleans_completed_files_and_queued_worker_failure(setup):
    grant(setup)
    job = await setup.service.submit_image("alice", image_request(), png())
    await setup.service.process(job["id"], 0)
    setup.clock.now += timedelta(days=1, seconds=1)
    with pytest.raises(ApiError, match="JOB_EXPIRED"):
        await setup.service.image("alice", job["id"], "translated")
    assert not setup.images.objects
    queued = await setup.service.submit_image("alice", image_request("new"), png())
    setup.clock.now += timedelta(days=1, seconds=1)
    await setup.service.process(queued["id"], 0)
    assert not setup.images.objects and not setup.upstream.image_calls[1:]


@pytest.mark.parametrize("authorization,status", [("", 401), ("Bearer dev:alice", 403)])
async def test_image_upload_auth_and_pro_denial_before_reading_any_body(setup, authorization, status):
    disable_free_images(setup)
    received = []
    async def body():
        received.append(True)
        yield b"image body must not be consumed"
    async with client(setup) as api:
        response = await api.post("/v1/image-translation-jobs", content=body(),
                                 headers={"Authorization": authorization, "Content-Type": "multipart/form-data; boundary=bound"})
    assert response.status_code == status
    assert not received and not setup.images.objects and not setup.upstream.image_calls


async def test_completed_image_needs_no_postcommit_read_and_keeps_png(setup):
    grant(setup)
    job = await setup.service.submit_image("alice", image_request(), png())
    original_get = setup.repository.get
    async def fail_any_postcommit_read(key):
        stored = setup.repository.documents.get(setup.store.job_key(job["id"]))
        if stored and stored["status"] == "completed":
            raise ConnectionError("Firestore temporarily unavailable after commit")
        return await original_get(key)
    setup.repository.get = fail_any_postcommit_read
    await setup.service.process(job["id"], 0)
    completed = setup.repository.documents[setup.store.job_key(job["id"])]
    assert completed["status"] == "completed"
    assert setup.images.objects[completed["output"]["objectKey"]][0] == png()
    assert setup.repository.documents[setup.store.user_key("alice")]["monthlyImageUsage"]["2026-10"] == {"used": 1, "reserved": 0}


@pytest.mark.parametrize("commit_before_failure", [False, True])
async def test_uncertain_image_commit_preserves_output_until_authoritative_recovery(setup, commit_before_failure):
    grant(setup)
    job = await setup.service.submit_image("alice", image_request(), png())
    original_atomic = setup.repository.atomic
    async def interrupted_ack(keys, operation, **options):
        stored = setup.repository.documents.get(setup.store.job_key(job["id"]))
        if stored and stored["status"] == "running" and any(key.endswith(".png") for key in setup.images.objects):
            if commit_before_failure:
                await original_atomic(keys, operation, **options)
            raise ConnectionError("Firestore commit acknowledgement lost")
        return await original_atomic(keys, operation, **options)
    setup.repository.atomic = interrupted_ack
    with pytest.raises(ApiError, match="SERVICE_UNAVAILABLE"):
        await setup.service.process(job["id"], 0)
    stored = setup.repository.documents[setup.store.job_key(job["id"])]
    output_keys = [key for key in setup.images.objects if key.endswith(".png")]
    assert len(output_keys) == 1 and setup.images.objects[output_keys[0]][0] == png()
    assert stored["status"] == ("completed" if commit_before_failure else "running")
    account = setup.repository.documents[setup.store.user_key("alice")]
    assert account["monthlyImageUsage"]["2026-10"] == ({"used": 1, "reserved": 0} if commit_before_failure else {"used": 0, "reserved": 1})
    setup.repository.atomic = original_atomic
    if commit_before_failure:
        # A retried Cloud Task observes the committed terminal job and retains its PNG.
        await setup.service.process(job["id"], 0)
        assert output_keys[0] in setup.images.objects and len(setup.upstream.image_calls) == 1
    else:
        # A definitive user cancellation later releases the reservation and orphan object.
        await setup.service.cancel("alice", job["id"], kind="image")
        assert not setup.images.objects


async def test_image_expiring_during_provider_completion_cleans_unchargeable_output(setup):
    grant(setup)
    job = await setup.service.submit_image("alice", image_request(), png())
    setup.upstream.started, setup.upstream.release = asyncio.Event(), asyncio.Event()
    running = asyncio.create_task(setup.service.process(job["id"], 0))
    await setup.upstream.started.wait()
    setup.clock.now += timedelta(days=1, seconds=1)
    setup.upstream.release.set()
    await running
    stored = setup.repository.documents[setup.store.job_key(job["id"])]
    assert stored["status"] == "failed" and stored["error"]["code"] == "JOB_EXPIRED"
    assert not setup.images.objects
    assert (await setup.store.get_image_quota("alice"))["usedImages"] == 0
