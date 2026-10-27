"""Opt-in integration against the emulator; never opens a real Firestore project."""
import asyncio
from dataclasses import replace
from datetime import UTC, datetime
import os
from uuid import uuid4

import pytest

from app.config import Settings
from app.models import ApiError, BillingSync, TranslationRequest, CharacterTranslationRequest, SubscriptionSync
from app.repository import FirestoreRepository
from app.service import JobStore


@pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="Firestore Emulator is required")
async def test_firestore_query_transaction_serializes_grants_reservations_and_refunds():
    # The demo project and test_ prefix are deliberately separate from billing
    # emulator records as well as the deployed translator's collection names.
    project = "demo-translator-billing"
    uid, order = uuid4().hex, uuid4().hex
    settings = Settings(project_id=project, billing_environment="test")
    settings = replace(settings, limits=replace(settings.limits,
        free=replace(settings.limits.free, monthly_words=0, monthly_images=0)))
    repository = FirestoreRepository(project, namespace="test_")
    store = JobStore(repository, settings, lambda: datetime(2026, 10, 25, tzinfo=UTC))
    payload = {"orderId": order, "environment": "test", "productId": "ai-translator-extension",
               "authProjectId": project, "uid": uid, "revision": 1, "purchasedAt": 1_700_000_000,
               "words": 2, "images": 1, "netGrantedWords": 2, "netGrantedImages": 1, "paymentState": "paid"}
    try:
        granted = await asyncio.gather(store.sync_purchase(BillingSync(**payload)), store.sync_purchase(BillingSync(**payload)))
        assert sum(result["applied"] for result in granted) == 1
        def request(key):
            return TranslationRequest(sourceLanguage="auto", targetLanguage="uk", idempotencyKey=key,
                segments=[{"id": "one", "text": "hello world"}])
        attempts = await asyncio.gather(store.create(uid, request("one")), store.create(uid, request("two")), return_exceptions=True)
        ids = [result for result in attempts if isinstance(result, str)]
        assert len(ids) == 1, [repr(result) for result in attempts]
        assert sum(isinstance(result, ApiError) and result.code == "QUOTA_EXCEEDED" for result in attempts) == 1
        claim = await store.claim(ids[0], 0)
        await store.sync_purchase(BillingSync(**{**payload, "revision": 2, "netGrantedWords": 0,
                                                "netGrantedImages": 0, "paymentState": "refunded"}))
        assert await store.finish(claim, translations=[{"id": "one", "text": "привіт"}])
        assert (await store.get_account(uid))["prepaid"] == {"words": 0, "images": 0, "reservedWords": 0, "reservedImages": 0}
        await store.sync_purchase(BillingSync(**{**payload, "revision": 3}))
        assert (await store.get_account(uid))["prepaid"] == {"words": 0, "images": 1, "reservedWords": 0, "reservedImages": 0}
        stale = await store.sync_purchase(BillingSync(**payload))
        assert not stale["applied"] and stale["revision"] == 3
    finally:
        await repository.close()


@pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="Firestore Emulator is required")
async def test_firestore_character_quota_and_subscription_revision_are_atomic():
    project, uid = "demo-translator-characters", uuid4().hex
    now = datetime(2026, 10, 27, 12, tzinfo=UTC)
    settings = Settings(project_id=project, billing_environment="test")
    settings = replace(settings, limits=replace(settings.limits,
        free=replace(settings.limits.free, monthly_characters=4)))
    repository = FirestoreRepository(project, namespace="test_")
    store = JobStore(repository, settings, lambda: now)
    try:
        def request(key):
            return CharacterTranslationRequest(sourceLanguage="auto", targetLanguage="uk", idempotencyKey=key,
                segments=[{"id": "one", "text": "a😀 b"}])
        attempts = await asyncio.gather(*(store.create_character(uid, request(str(i))) for i in range(6)), return_exceptions=True)
        ids = [result for result in attempts if isinstance(result, str)]
        assert len(ids) == 1, [repr(result) for result in attempts]
        assert sum(isinstance(result, ApiError) and result.code == "QUOTA_EXCEEDED" for result in attempts) == 5
        assert (await store.get_character_account(uid))["characterQuota"]["reservedCharacters"] == 4
        stamp = int(now.timestamp())
        payload = {"environment": "test", "productId": "ai-translator-extension", "authProjectId": project,
                   "uid": uid, "revision": 1, "subscriptionId": "sub_emulator", "status": "active",
                   "blockedReason": None, "paidPeriodStart": stamp, "paidThrough": stamp + 86400,
                   "quotaAnchorAt": stamp, "policyVersion": 2}
        replies = await asyncio.gather(*(store.sync_subscription(SubscriptionSync(**payload)) for _ in range(6)))
        assert sum(reply["applied"] for reply in replies) == 1
        assert (await store.get_character_account(uid))["plan"] == "pro"
        claim = await store.claim(ids[0], 0)
        assert await store.finish(claim, translations=[{"id": "one", "text": "переклад"}])
        assert (await store.get_character_account(uid))["characterQuota"]["usedCharacters"] == 0, "Free job settles in its original quota"
        await store.sync_subscription(SubscriptionSync(**{**payload, "revision": 3, "blockedReason": "refunded"}))
        stale = await store.sync_subscription(SubscriptionSync(**{**payload, "revision": 2}))
        assert stale == {"ok": True, "applied": False, "revision": 3}
        account = await store.get_character_account(uid)
        assert account["plan"] == "free"
        assert account["characterQuota"]["usedCharacters"] == 4
    finally:
        await repository.close()
