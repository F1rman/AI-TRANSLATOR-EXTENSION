import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

import httpx
from PIL import Image
import pytest

from app.auth import DevelopmentTaskAuth, DevelopmentUserAuth, TaskOidcAuth
from app.billing import purchase_key
from app.config import Settings
from app.main import Runtime, create_app
from app.models import ApiError, BillingSync, ImageTranslationRequest, TranslationRequest
from app.repository import MemoryRepository
from app.service import JobStore, TranslationService


class Upstream:
    error = None

    async def translate(self, payload):
        if self.error:
            raise self.error
        return [{"id": item["id"], "text": "translated"} for item in payload["segments"]]

    async def translate_image(self, data, mime, payload):
        if self.error:
            raise self.error
        return png()


class Dispatcher:
    async def enqueue(self, *args, **kwargs):
        pass


def png():
    output = BytesIO()
    Image.new("RGB", (4, 4), "white").save(output, "PNG")
    return output.getvalue()


def request(words=1, key="text"):
    return TranslationRequest(sourceLanguage="auto", targetLanguage="uk", idempotencyKey=key,
                              segments=[{"id": "one", "text": " ".join(["word"] * words)}])


def snapshot(order="order_one", **changes):
    return BillingSync(**{"orderId": order, "environment": "live", "productId": "ai-translator-extension",
                         "authProjectId": "ai-translator-ext", "uid": "alice", "revision": 1,
                         "purchasedAt": 1_700_000_000, "words": 10, "images": 3,
                         "netGrantedWords": 10, "netGrantedImages": 3, "paymentState": "paid", **changes})


@pytest.fixture
def setup():
    settings = Settings(mode="memory", project_id="ai-translator-ext", allow_dev_auth=True)
    settings = replace(settings, limits=replace(settings.limits,
        free=replace(settings.limits.free, monthly_words=0, monthly_images=0)))
    clock = SimpleNamespace(now=datetime(2026, 10, 31, 23, 59, 59, tzinfo=UTC))
    repository = MemoryRepository()
    store = JobStore(repository, settings, lambda: clock.now)
    service = TranslationService(store, Dispatcher(), Upstream())
    return SimpleNamespace(settings=settings, clock=clock, repository=repository, store=store, service=service)


async def complete(setup, identifier):
    await setup.service.process(identifier, 0)


async def test_purchase_delivery_is_atomic_idempotent_and_never_grants_pro(setup):
    results = await asyncio.gather(*[setup.store.sync_purchase(snapshot()) for _ in range(12)])
    assert sum(result["applied"] for result in results) == 1
    account = await setup.store.get_account("alice")
    assert account["prepaid"] == {"words": 10, "images": 3, "reservedWords": 0, "reservedImages": 0}
    assert account["plan"] == "free"
    assert account["quota"]["monthlyWords"] == 0
    assert (await setup.store.get_account("bob"))["prepaid"]["words"] == 0


@pytest.mark.parametrize("changes", [{"uid": "bob"}, {"words": 12}, {"images": 5}, {"purchasedAt": 1_700_000_001}])
async def test_same_order_cannot_change_identity_or_original_terms(setup, changes):
    await setup.store.sync_purchase(snapshot())
    with pytest.raises(ApiError, match="PURCHASE_CONFLICT"):
        await setup.store.sync_purchase(snapshot(revision=2, **changes))
    assert (await setup.store.get_account("alice"))["prepaid"]["words"] == 10


async def test_refund_before_initial_paid_delivery_and_revision_conflicts(setup):
    refunded = snapshot(revision=3, netGrantedWords=0, netGrantedImages=0, paymentState="refunded")
    await setup.store.sync_purchase(refunded)
    assert not (await setup.store.sync_purchase(snapshot()))["applied"]
    with pytest.raises(ApiError, match="PURCHASE_CONFLICT"):
        await setup.store.sync_purchase(snapshot(revision=3))
    assert (await setup.store.get_account("alice"))["prepaid"]["words"] == 0
    assert setup.repository.documents[purchase_key("live", "order_one")]["revision"] == 3


async def test_monthly_allowance_first_then_fifo_packages_and_rollover(setup):
    setup.store.settings = replace(setup.settings, limits=replace(setup.settings.limits,
        free=replace(setup.settings.limits.free, monthly_words=2)))
    await setup.store.sync_purchase(snapshot("first", words=3, netGrantedWords=3))
    await setup.store.sync_purchase(snapshot("second", purchasedAt=1_700_000_001))
    identifier = await setup.store.create("alice", request(6))
    slot = setup.repository.documents[setup.store.user_key("alice")]["activeJobs"][identifier]
    assert slot["amount"] == 2
    assert [allocation["amount"] for allocation in slot["prepaid"]] == [3, 1]
    setup.clock.now += timedelta(seconds=2)
    await complete(setup, identifier)
    account = await setup.store.get_account("alice")
    assert account["prepaid"]["words"] == 9
    assert account["quota"]["remainingWords"] == 2
    assert setup.repository.documents[setup.store.user_key("alice")]["monthlyUsage"]["2026-10"] == {"used": 2, "reserved": 0}


async def test_competing_requests_cannot_spend_the_last_credit_twice(setup):
    await setup.store.sync_purchase(snapshot(words=1, netGrantedWords=1))
    results = await asyncio.gather(*[setup.store.create("alice", request(key=str(i))) for i in range(10)], return_exceptions=True)
    assert sum(isinstance(result, str) for result in results) == 1
    assert all(isinstance(result, str) or (isinstance(result, ApiError) and result.code == "QUOTA_EXCEEDED") for result in results)
    account = await setup.store.get_account("alice")
    assert account["prepaid"]["words"] == 0 and account["prepaid"]["reservedWords"] == 1


async def test_concurrent_purchase_and_job_updates_do_not_lose_credits(setup):
    await setup.store.sync_purchase(snapshot("first"))
    identifier, _ = await asyncio.gather(setup.store.create("alice", request(4)), setup.store.sync_purchase(snapshot("second")))
    await complete(setup, identifier)
    assert (await setup.store.get_account("alice"))["prepaid"]["words"] == 16


async def test_provider_failure_releases_exact_paid_and_monthly_sources(setup):
    setup.store.settings = replace(setup.settings, limits=replace(setup.settings.limits,
        free=replace(setup.settings.limits.free, monthly_words=2)))
    await setup.store.sync_purchase(snapshot())
    identifier = await setup.store.create("alice", request(5))
    setup.service.upstream.error = ApiError("UPSTREAM_UNAVAILABLE", "Try again", 503)
    await complete(setup, identifier)
    account = await setup.store.get_account("alice")
    assert account["quota"]["remainingWords"] == 2
    assert account["prepaid"]["words"] == 10
    assert account["prepaid"]["reservedWords"] == 0


@pytest.mark.parametrize("charge", [False, True])
async def test_refund_during_accepted_job_keeps_reservation_but_never_restores_revoked_units(setup, charge):
    await setup.store.sync_purchase(snapshot("first"))
    await setup.store.sync_purchase(snapshot("second", purchasedAt=1_700_000_001))
    identifier = await setup.store.create("alice", request(7))
    await setup.store.sync_purchase(snapshot("first", revision=2, netGrantedWords=0, netGrantedImages=0, paymentState="refunded"))
    assert (await setup.store.get_account("alice"))["prepaid"] == {"words": 10, "images": 3, "reservedWords": 7, "reservedImages": 0}
    if charge:
        await complete(setup, identifier)
    else:
        await setup.store.cancel("alice", identifier)
    account = await setup.store.get_account("alice")
    assert account["prepaid"] == {"words": 10, "images": 3, "reservedWords": 0, "reservedImages": 0}
    lot = setup.repository.documents[purchase_key("live", "first")]
    assert lot["consumedWords"] == (7 if charge else 0)
    assert lot["availableWords"] == 0


async def test_partial_refund_and_won_dispute_restore_only_unused_own_purchase(setup):
    await setup.store.sync_purchase(snapshot("first"))
    identifier = await setup.store.create("alice", request(7))
    await complete(setup, identifier)
    await setup.store.sync_purchase(snapshot("second", purchasedAt=1_700_000_001))
    await setup.store.sync_purchase(snapshot("first", revision=2, netGrantedWords=5, netGrantedImages=1, paymentState="partially_refunded"))
    assert (await setup.store.get_account("alice"))["prepaid"]["words"] == 10
    await setup.store.sync_purchase(snapshot("first", revision=3, netGrantedWords=0, netGrantedImages=0, paymentState="disputed"))
    await setup.store.sync_purchase(snapshot("first", revision=4))
    assert (await setup.store.get_account("alice"))["prepaid"]["words"] == 13
    assert setup.repository.documents[purchase_key("live", "first")]["consumedWords"] == 7


async def test_fully_spent_refund_creates_no_debt_against_new_purchases(setup):
    await setup.store.sync_purchase(snapshot())
    identifier = await setup.store.create("alice", request(10))
    await complete(setup, identifier)
    await setup.store.sync_purchase(snapshot(revision=2, netGrantedWords=0, netGrantedImages=0, paymentState="refunded"))
    await setup.store.sync_purchase(snapshot("new", words=2, netGrantedWords=2))
    assert (await setup.store.get_account("alice"))["prepaid"]["words"] == 2


async def test_expired_reservation_releases_to_current_cap_and_old_retry_is_safe(setup):
    await setup.store.sync_purchase(snapshot())
    await setup.store.create("alice", request(8))
    await setup.store.sync_purchase(snapshot(revision=2, netGrantedWords=5, netGrantedImages=1, paymentState="partially_refunded"))
    setup.clock.now += timedelta(days=2)
    account = await setup.store.get_account("alice")
    assert account["prepaid"] == {"words": 5, "images": 1, "reservedWords": 0, "reservedImages": 0}
    await setup.store.sync_purchase(snapshot())
    assert (await setup.store.get_account("alice"))["prepaid"]["words"] == 5


async def test_paid_images_work_without_monthly_image_feature_and_complete_after_refund(setup):
    await setup.store.sync_purchase(snapshot(images=1, netGrantedImages=1))
    assert (await setup.store.get_account("alice"))["features"]["imageTranslation"]
    job = await setup.service.submit_image("alice", ImageTranslationRequest(
        sourceLanguage="auto", targetLanguage="uk", idempotencyKey="image"), png())
    retry = await setup.service.submit_image("alice", ImageTranslationRequest(
        sourceLanguage="auto", targetLanguage="uk", idempotencyKey="image"), png())
    assert retry["id"] == job["id"]
    await setup.store.sync_purchase(snapshot(revision=2, images=1, netGrantedWords=0, netGrantedImages=0, paymentState="refunded"))
    await complete(setup, job["id"])
    assert (await setup.service.get("alice", job["id"], kind="image"))["status"] == "completed"
    assert (await setup.store.get_account("alice"))["prepaid"]["images"] == 0
    assert not (await setup.store.get_account("alice"))["features"]["imageTranslation"]


async def test_manual_pro_allowance_is_preserved_and_spent_before_packages(setup):
    setup.repository.documents[setup.store.entitlement_key("alice")] = {"plan": "pro"}
    await setup.store.sync_purchase(snapshot())
    identifier = await setup.store.create("alice", request(3))
    await complete(setup, identifier)
    account = await setup.store.get_account("alice")
    assert account["plan"] == "pro" and account["prepaid"]["words"] == 10
    assert account["quota"]["usedWords"] == 3


async def test_billing_route_requires_dedicated_identity_and_rejects_test_and_foreign_tokens(setup):
    async def billing_auth(header):
        if header != "Bearer billing-oidc":
            raise ApiError("UNAUTHENTICATED", "A billing sender is required.", 401)
    runtime = Runtime(setup.settings, setup.service, DevelopmentUserAuth(), DevelopmentTaskAuth(), billing_auth)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(runtime)), base_url="https://test") as client:
        path = "/internal/billing-sync"
        assert (await client.post(path, json=snapshot().model_dump(), headers={"Authorization": "Bearer dev:alice"})).status_code == 401
        assert (await client.post(path, json=snapshot().model_dump(), headers={"Authorization": "Bearer dev-task"})).status_code == 401
        headers = {"Authorization": "Bearer billing-oidc"}
        assert (await client.post(path, json=snapshot(environment="test").model_dump(), headers=headers)).status_code == 409
        assert (await client.post(path, json=snapshot(authProjectId="foreign").model_dump(), headers=headers)).status_code == 403
        assert (await client.post(path, json=snapshot().model_dump(), headers=headers)).status_code == 200
        response = await client.get("/v1/me", headers={"Authorization": "Bearer dev:alice"})
        assert response.json()["prepaid"]["words"] == 10


async def test_billing_is_disabled_without_configured_sender(setup):
    runtime = Runtime(setup.settings, setup.service, DevelopmentUserAuth(), DevelopmentTaskAuth())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(runtime)), base_url="https://test") as client:
        response = await client.post("/internal/billing-sync", json=snapshot().model_dump())
        assert response.status_code == 503


async def test_billing_oidc_checks_configured_audience_and_exact_sender(monkeypatch):
    from google.oauth2 import id_token
    calls = []
    def verify(token, request, audience):
        calls.append((token, audience))
        return {"email": "billing@billing.iam.gserviceaccount.com", "email_verified": True}
    monkeypatch.setattr(id_token, "verify_oauth2_token", verify)
    verifier = TaskOidcAuth("https://translator.run.app/internal/billing-sync", "billing@billing.iam.gserviceaccount.com")
    await verifier("Bearer oidc")
    assert calls == [("oidc", "https://translator.run.app/internal/billing-sync")]
    with pytest.raises(ApiError):
        await TaskOidcAuth("https://translator.run.app/internal/billing-sync", "worker@translator.iam.gserviceaccount.com")("Bearer oidc")


@pytest.mark.parametrize('environment,enabled', [('live', False), ('live', True), ('test', False), ('test', True)])
async def test_me_reports_billing_environment_and_configured_delivery_without_secrets(setup, environment, enabled):
    settings = replace(setup.settings, billing_environment=environment,
        billing_service_account='sender@billing.iam.gserviceaccount.com' if enabled else '',
        billing_audience='https://translator.example/internal/billing-sync' if enabled else '')
    runtime = Runtime(settings, setup.service, DevelopmentUserAuth(), DevelopmentTaskAuth())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(runtime)), base_url='https://test') as client:
        response = await client.get('/v1/me', headers={'Authorization': 'Bearer dev:alice'})
        assert response.status_code == 200
        value = response.json()
        assert value['billing'] == {'environment': environment, 'purchasesEnabled': enabled}
        assert 'billing_service_account' not in value and 'billing_audience' not in value
        assert value['quota']['monthlyWords'] == 0 and value['prepaid']['words'] == 0
