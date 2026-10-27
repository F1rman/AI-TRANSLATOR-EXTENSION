"""Behavioral coverage for paid, source-character based translation quotas."""
import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest

from app.auth import DevelopmentTaskAuth, DevelopmentUserAuth
from app.config import Settings
from app.main import Runtime, create_app
from app.models import ApiError, BillingSync
from app.repository import MemoryRepository
from app.service import JobStore, TranslationService


class Dispatcher:
    def __init__(self):
        self.calls = []

    async def enqueue(self, identifier, generation, **options):
        self.calls.append((identifier, generation, options))


class Upstream:
    def __init__(self):
        self.calls = []
        self.error = None

    async def translate(self, payload):
        self.calls.append(payload)
        if self.error:
            raise self.error
        return [{"id": segment["id"], "text": "translated"} for segment in payload["segments"]]


@pytest.fixture
def setup():
    settings = Settings(mode="memory", project_id="ai-translator-ext", allow_dev_auth=True)
    clock = SimpleNamespace(now=datetime(2026, 10, 27, 12, tzinfo=UTC))
    repository = MemoryRepository()
    store = JobStore(repository, settings, lambda: clock.now)
    dispatcher, upstream = Dispatcher(), Upstream()
    service = TranslationService(store, dispatcher, upstream)

    async def billing_auth(header):
        if header != "Bearer billing-oidc":
            raise ApiError("UNAUTHENTICATED", "A billing identity is required.", 401)

    runtime = Runtime(settings, service, DevelopmentUserAuth(), DevelopmentTaskAuth(), billing_auth)
    return SimpleNamespace(settings=settings, clock=clock, repository=repository, store=store,
                           dispatcher=dispatcher, upstream=upstream, service=service, runtime=runtime)


def client_for(setup, uid="alice"):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(setup.runtime)),
                             base_url="https://translator.test", headers={"Authorization": f"Bearer dev:{uid}"})


def request(text="Hello", key="request", **changes):
    return {"sourceLanguage": "auto", "targetLanguage": "uk", "segments": [{"id": "first", "text": text}],
            "idempotencyKey": key, **changes}


def snapshot(now, **changes):
    anchor = int(now.timestamp())
    return {"environment": "live", "productId": "ai-translator-extension",
            "authProjectId": "ai-translator-ext", "uid": "alice", "revision": 1,
            "subscriptionId": "sub_alice", "status": "active", "blockedReason": None,
            "paidPeriodStart": anchor, "paidThrough": anchor + 366 * 86400,
            "quotaAnchorAt": anchor, "policyVersion": 2, **changes}


async def sync(client, payload):
    return await client.post("/internal/subscription-sync", json=payload,
                             headers={"Authorization": "Bearer billing-oidc"})


async def submit(client, payload):
    response = await client.post("/v2/translation-jobs", json=payload)
    assert response.status_code == 202, response.text
    return response.json()


async def account(client):
    response = await client.get("/v2/me")
    assert response.status_code == 200, response.text
    return response.json()


async def test_free_account_exposes_honest_character_quota_and_server_capabilities(setup):
    async with client_for(setup) as client:
        value = await account(client)
        assert value["plan"] == "free"
        assert value["characterQuota"] == {
            "monthlyCharacters": 100_000, "usedCharacters": 0, "reservedCharacters": 0,
            "remainingCharacters": 100_000, "periodStart": "2026-10-01T00:00:00Z",
            "resetsAt": "2026-11-01T00:00:00Z"}
        assert value["limits"]["maxCharactersPerJob"] == 4000
        assert value["features"]["pageTranslation"] is False
        assert value["features"]["pageContext"] is False
        assert value["features"]["historyLimit"] == 20
        assert value["features"]["priority"] is False
        assert value["features"]["imageTranslation"] is False
        assert "prepaid" not in value


async def test_source_unicode_codepoints_whitespace_and_segments_are_counted_once(setup):
    pieces = ["Привіт 👋🏽", "e\u0301\n  世界"]
    size = sum(len(text) for text in pieces)
    async with client_for(setup) as client:
        payload = request(segments=[{"id": str(i), "text": text} for i, text in enumerate(pieces)])
        job = await submit(client, payload)
        assert (await account(client))["characterQuota"]["reservedCharacters"] == size
        await setup.service.process(job["id"], 0)
        await setup.service.process(job["id"], 0)
        quota = (await account(client))["characterQuota"]
        assert (quota["usedCharacters"], quota["reservedCharacters"]) == (size, 0)
        assert len(setup.upstream.calls) == 1


async def test_free_and_pro_character_caps_are_enforced_from_authoritative_plan(setup):
    async with client_for(setup) as client:
        job = await submit(client, request("😀" * 4000))
        await client.delete(f'/v2/translation-jobs/{job["id"]}')
        rejected = await client.post("/v2/translation-jobs", json=request("a" * 4001, key="too-long"))
        assert rejected.status_code == 422
        forged = await client.post("/v2/translation-jobs", json=request("a", plan="pro"))
        assert forged.status_code == 422
        assert (await sync(client, snapshot(setup.clock.now))).status_code == 200
        assert (await account(client))["limits"]["maxCharactersPerJob"] == 50_000
        pro_job = await submit(client, request("😀" * 50_000, key="pro"))
        assert (await account(client))["characterQuota"]["reservedCharacters"] == 50_000
        await client.delete(f'/v2/translation-jobs/{pro_job["id"]}')
        rejected = await client.post("/v2/translation-jobs", json=request("a" * 50_001, key="over-pro"))
        assert rejected.status_code == 422


@pytest.mark.parametrize("feature", [{"mode": "page"}, {"tone": "formal"}, {"context": "A short technical manual"}])
async def test_pro_feature_gates_reject_free_before_reserving_or_dispatching(setup, feature):
    async with client_for(setup) as client:
        response = await client.post("/v2/translation-jobs", json=request(**feature))
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "PRO_REQUIRED"
        assert not setup.dispatcher.calls
        assert (await account(client))["characterQuota"]["reservedCharacters"] == 0
        assert (await sync(client, snapshot(setup.clock.now))).status_code == 200
        job = await submit(client, request(**feature))
        await setup.service.process(job["id"], 0)
        for name, value in feature.items():
            assert setup.upstream.calls[0][name] == value
        assert (await account(client))["features"]["historyLimit"] == 1000


async def test_optional_text_controls_are_strict_and_part_of_idempotency(setup):
    async with client_for(setup) as client:
        assert (await sync(client, snapshot(setup.clock.now))).status_code == 200
        payload = request(context="technical", mode="page", tone="technical")
        responses = await asyncio.gather(*[client.post("/v2/translation-jobs", json=payload) for _ in range(8)])
        assert all(response.status_code == 202 for response in responses)
        assert len({response.json()["id"] for response in responses}) == 1
        for changed in ({"context": "other"}, {"tone": "formal"}, {"mode": "text"}):
            conflict = await client.post("/v2/translation-jobs", json={**payload, **changed})
            assert conflict.status_code == 409
            assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
        for changed in ({"tone": "angry"}, {"mode": "system"}, {"context": "a" * 2001}):
            invalid = await client.post("/v2/translation-jobs", json=request(key="invalid", **changed))
            assert invalid.status_code == 422
        assert (await account(client))["characterQuota"]["reservedCharacters"] == len(payload["segments"][0]["text"])


async def test_concurrent_requests_cannot_reserve_last_free_characters_twice(setup):
    async with client_for(setup) as client:
        for i in range(25):
            size = 4000 if i < 24 else 3998
            job = await submit(client, request("a" * size, key=f"consume-{i}"))
            await setup.service.process(job["id"], 0)
        assert (await account(client))["characterQuota"]["remainingCharacters"] == 2
        responses = await asyncio.gather(*[
            client.post("/v2/translation-jobs", json=request("ab", key=f"race-{i}")) for i in range(10)])
        assert sum(response.status_code == 202 for response in responses) == 1
        assert all(response.status_code == 202 or response.status_code == 429
                   and response.json()["error"]["code"] == "QUOTA_EXCEEDED" for response in responses)
        assert (await account(client))["characterQuota"]["reservedCharacters"] == 2


async def test_cancel_failure_and_late_worker_do_not_double_charge_character_reservation(setup):
    async with client_for(setup) as client:
        job = await submit(client, request("before cancellation"))
        claim = await setup.store.claim(job["id"], 0)
        assert (await client.delete(f'/v2/translation-jobs/{job["id"]}')).status_code == 200
        assert not await setup.store.finish(claim, translations=[{"id": "first", "text": "late"}])
        setup.upstream.error = ApiError("UPSTREAM_TIMEOUT", "Timed out", 504)
        failed = await submit(client, request("provider failure", key="failure"))
        await setup.service.process(failed["id"], 0)
        value = (await client.get(f'/v2/translation-jobs/{failed["id"]}')).json()
        assert value["status"] == "failed"
        quota = (await account(client))["characterQuota"]
        assert quota["usedCharacters"] == quota["reservedCharacters"] == 0
        assert quota["remainingCharacters"] == 100_000


async def test_idempotent_rollover_finishes_original_month_without_consuming_new_month(setup):
    setup.clock.now = datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC)
    async with client_for(setup) as client:
        payload = request("hello", key="rollover")
        job = await submit(client, payload)
        setup.clock.now += timedelta(seconds=2)
        retry = await submit(client, payload)
        assert retry["id"] == job["id"]
        assert (await account(client))["characterQuota"]["reservedCharacters"] == 0
        await setup.service.process(job["id"], 0)
        quota = (await account(client))["characterQuota"]
        assert quota["usedCharacters"] == quota["reservedCharacters"] == 0
        assert quota["periodStart"] == "2027-01-01T00:00:00Z"
        counters = setup.repository.documents[setup.store.user_key("alice")]["characterUsage"]
        assert counters["free:2026-12-01T00:00:00Z"] == {"used": 5, "reserved": 0}


@pytest.mark.parametrize("now, start, reset", [
    (datetime(2028, 2, 29, 11, 14, 14, tzinfo=UTC), "2028-01-31T11:14:15Z", "2028-02-29T11:14:15Z"),
    (datetime(2028, 2, 29, 11, 14, 15, tzinfo=UTC), "2028-02-29T11:14:15Z", "2028-03-31T11:14:15Z"),
    (datetime(2028, 3, 31, 11, 14, 15, tzinfo=UTC), "2028-03-31T11:14:15Z", "2028-04-30T11:14:15Z"),
    (datetime(2028, 4, 30, 11, 14, 15, tzinfo=UTC), "2028-04-30T11:14:15Z", "2028-05-31T11:14:15Z"),
])
async def test_annual_pro_quota_months_clamp_independently_to_original_utc_anchor(setup, now, start, reset):
    anchor = datetime(2028, 1, 31, 11, 14, 15, tzinfo=UTC)
    setup.clock.now = now
    async with client_for(setup) as client:
        assert (await sync(client, snapshot(anchor))).status_code == 200
        quota = (await account(client))["characterQuota"]
        assert quota["monthlyCharacters"] == 2_000_000
        assert (quota["periodStart"], quota["resetsAt"]) == (start, reset)


async def test_subscription_expiry_and_payment_blocks_change_plan_without_webhook(setup):
    paid_until = int((setup.clock.now + timedelta(seconds=30)).timestamp())
    async with client_for(setup) as client:
        initial = snapshot(setup.clock.now, paidThrough=paid_until, status="past_due")
        assert (await sync(client, initial)).status_code == 200
        assert (await account(client))["plan"] == "pro"
        setup.clock.now += timedelta(seconds=30)
        expired = await account(client)
        assert expired["plan"] == "free"
        assert expired["features"]["pageTranslation"] is False
        assert (await sync(client, snapshot(setup.clock.now, revision=2, blockedReason="payment_disputed"))).status_code == 200
        assert (await account(client))["plan"] == "free"


async def test_subscription_sync_is_revisioned_idempotent_owned_and_environment_bound(setup):
    async with client_for(setup) as client:
        value = snapshot(setup.clock.now)
        rejected = await client.post("/internal/subscription-sync", json=value)
        assert rejected.status_code == 401
        responses = await asyncio.gather(*[sync(client, value) for _ in range(8)])
        assert all(response.status_code == 200 for response in responses)
        assert sum(response.json()["applied"] for response in responses) == 1
        conflict = await sync(client, {**value, "blockedReason": "disputed"})
        assert conflict.status_code == 409
        assert conflict.json()["error"]["code"] == "SUBSCRIPTION_CONFLICT"
        assert (await sync(client, {**value, "revision": 3, "blockedReason": "disputed"})).status_code == 200
        stale = await sync(client, {**value, "revision": 2})
        assert stale.status_code == 200 and stale.json()["applied"] is False
        assert (await account(client))["plan"] == "free"
        assert (await sync(client, {**value, "environment": "test", "revision": 4})).status_code == 409
        assert (await sync(client, {**value, "authProjectId": "foreign", "revision": 4})).status_code == 403
    async with client_for(setup, "bob") as other:
        assert (await account(other))["plan"] == "free"


async def test_manual_pro_grant_keeps_own_anchor_and_is_separate_from_subscription_snapshots(setup):
    granted = datetime(2026, 1, 31, 9, 15, tzinfo=UTC)
    setup.clock.now = datetime(2026, 2, 28, 9, 15, tzinfo=UTC)
    setup.repository.documents[setup.store.entitlement_key("alice")] = {
        "plan": "pro", "updatedAt": granted, "expiresAt": None}
    async with client_for(setup) as client:
        before = await account(client)
        assert before["plan"] == "pro"
        assert before["characterQuota"]["periodStart"] == "2026-02-28T09:15:00Z"
        assert before["characterQuota"]["resetsAt"] == "2026-03-31T09:15:00Z"
        blocked = snapshot(setup.clock.now, blockedReason="disputed")
        assert (await sync(client, blocked)).status_code == 200
        assert (await account(client))["plan"] == "pro"
        assert setup.repository.documents[setup.store.entitlement_key("alice")]["updatedAt"] == granted
        setup.repository.documents[setup.store.entitlement_key("alice")] = {"plan": "free"}
        assert (await account(client))["plan"] == "free"


async def test_stale_old_subscription_cannot_revoke_new_paid_subscription(setup):
    async with client_for(setup) as client:
        original = snapshot(setup.clock.now)
        assert (await sync(client, original)).status_code == 200
        replacement = {**original, "revision": 3, "subscriptionId": "sub_replacement"}
        assert (await sync(client, replacement)).status_code == 200
        old_cancelled = {**original, "revision": 2, "status": "canceled", "paidThrough": None,
                         "paidPeriodStart": None, "quotaAnchorAt": None}
        response = await sync(client, old_cancelled)
        assert response.status_code == 200 and response.json()["applied"] is False
        assert (await account(client))["plan"] == "pro"
        assert setup.repository.documents[setup.store.subscription_key("alice")]["subscriptionId"] == "sub_replacement"


async def test_v2_does_not_spend_or_advertise_retired_purchased_words(setup):
    await setup.store.sync_purchase(BillingSync(
        orderId="legacy-purchase", environment="live", productId="ai-translator-extension",
        authProjectId="ai-translator-ext", uid="alice", revision=1,
        purchasedAt=1_700_000_000, words=1_000_000, images=2,
        netGrantedWords=1_000_000, netGrantedImages=2, paymentState="paid"))
    async with client_for(setup) as client:
        for i in range(25):
            job = await submit(client, request("a" * 4000, key=f"exhaust-{i}"))
            await setup.service.process(job["id"], 0)
        rejected = await client.post("/v2/translation-jobs", json=request("a", key="no-fallback"))
        assert rejected.status_code == 429
        assert rejected.json()["error"]["code"] == "QUOTA_EXCEEDED"
        value = await account(client)
        assert "prepaid" not in value
        assert value["features"]["imageTranslation"] is False
        assert (await setup.store.get_account("alice"))["prepaid"]["words"] == 1_000_000


async def test_legacy_text_creation_requires_update_but_v1_account_reads_remain_available(setup):
    async with client_for(setup) as client:
        response = await client.post("/v1/translation-jobs", json=request())
        assert response.status_code in {409, 426}
        assert response.json()["error"]["code"] == "UPDATE_REQUIRED"
        assert (await client.get("/v1/me")).status_code == 200


async def test_v2_job_ownership_is_enforced_for_read_and_cancel(setup):
    async with client_for(setup) as client:
        job = await submit(client, request())
    async with client_for(setup, "bob") as other:
        for response in (await other.get(f'/v2/translation-jobs/{job["id"]}'),
                         await other.delete(f'/v2/translation-jobs/{job["id"]}')):
            assert response.status_code == 404


async def test_undated_manual_grant_migrates_its_anchor_once_and_expiry_is_enforced(setup):
    setup.repository.documents[setup.store.entitlement_key("alice")] = {"plan": "pro"}
    async with client_for(setup) as client:
        first = await account(client)
        anchor = setup.repository.documents[setup.store.entitlement_key("alice")]["quotaAnchorAt"]
        assert anchor == int(setup.clock.now.timestamp())
        setup.clock.now += timedelta(days=5)
        assert (await account(client))["characterQuota"]["periodStart"] == first["characterQuota"]["periodStart"]
        assert setup.repository.documents[setup.store.entitlement_key("alice")]["quotaAnchorAt"] == anchor
        setup.repository.documents[setup.store.entitlement_key("alice")]["expiresAt"] = setup.clock.now
        assert (await account(client))["plan"] == "free"


async def test_priority_is_persisted_from_verified_plan_and_recovery_keeps_it(setup):
    async with client_for(setup) as client:
        free_job = await submit(client, request())
        assert setup.dispatcher.calls[-1][2].get("priority", False) is False
        await client.delete(f'/v2/translation-jobs/{free_job["id"]}')
        assert (await sync(client, snapshot(setup.clock.now))).status_code == 200
        pro_job = await submit(client, request(key="pro-priority"))
        assert setup.dispatcher.calls[-1][2] == {"priority": True}
        stored = setup.repository.documents[setup.store.job_key(pro_job["id"])]
        assert stored["tier"] == "pro" and stored["priority"] is True
        setup.clock.now += timedelta(seconds=121)
        await setup.service.reconcile()
        assert setup.dispatcher.calls[-1] == (pro_job["id"], 1, {"priority": True})


async def test_expired_pro_page_job_is_rejected_before_provider_and_releases_reservation(setup):
    async with client_for(setup) as client:
        paid_until = int((setup.clock.now + timedelta(seconds=2)).timestamp())
        assert (await sync(client, snapshot(setup.clock.now, paidThrough=paid_until))).status_code == 200
        job = await submit(client, request(mode="page"))
        setup.clock.now += timedelta(seconds=3)
        await setup.service.process(job["id"], 0)
        value = (await client.get(f'/v2/translation-jobs/{job["id"]}')).json()
        assert value["status"] == "failed" and value["error"]["code"] == "PRO_REQUIRED"
        assert setup.upstream.calls == []
        assert (await account(client))["characterQuota"]["reservedCharacters"] == 0


async def test_upgrading_does_not_convert_or_spend_legacy_word_usage(setup):
    setup.repository.documents[setup.store.user_key("alice")] = {"monthlyUsage": {"2026-10": {"used": 9999, "reserved": 0}}}
    async with client_for(setup) as client:
        assert (await account(client))["characterQuota"]["usedCharacters"] == 0
        job = await submit(client, request("abc"))
        await setup.service.process(job["id"], 0)
        assert (await account(client))["characterQuota"]["usedCharacters"] == 3
        assert setup.repository.documents[setup.store.user_key("alice")]["monthlyUsage"]["2026-10"]["used"] == 9999
