import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
import json

import pytest

from app.config import Settings
from app.limits import load_limits
from app.models import ApiError, TranslationRequest
from app.repository import MemoryRepository
from app.service import JobStore, month_period
from app.words import count_words


@pytest.mark.parametrize("text, expected", [
    ("", 0), ("  \n\t", 0), ("Hello, world!", 2),
    ("can't can’t п’ять п'ять", 4), ("cafe\u0301 déjà vu", 3),
    ("مرحبا بالعالم", 2), ("你好世界", 4), ("日本語 テスト", 4),
    ("👋🏽 🧑‍💻 🇺🇦 !!!", 0), ("32.3 10,000", 2), ("one-two foo_bar", 3),
])
def test_unicode_word_accounting(text, expected):
    assert count_words(text) == expected


def test_single_packaged_file_defines_default_allowances_and_env_cannot_override(monkeypatch):
    monkeypatch.setenv("BACKEND_MODE", "memory")
    monkeypatch.setenv("DAILY_CHARACTER_LIMIT", "1")
    monkeypatch.setenv("DAILY_IMAGE_LIMIT", "1")
    monkeypatch.setenv("MONTHLY_WORD_LIMIT", "1")
    config = Settings.from_environment()
    assert config.limits.free.monthly_words == 10_000
    assert config.limits.pro.monthly_words == 200_000
    assert config.limits.free.monthly_images == 5
    assert config.limits.pro.monthly_images == 150


@pytest.mark.parametrize("change", [
    {"period": "day"}, {"timezone": "Europe/Kyiv"}, {"unexpected": 1},
    {"plans": {"free": {"monthlyWords": 1, "monthlyImages": 0}}},
    {"plans": {"free": {"monthlyWords": True, "monthlyImages": 0}, "pro": {"monthlyWords": 1, "monthlyImages": 2}}},
    {"plans": {"free": {"monthlyWords": -1, "monthlyImages": 0}, "pro": {"monthlyWords": 1, "monthlyImages": 2}}},
    {"plans": {"free": {"monthlyWords": "100", "monthlyImages": 0}, "pro": {"monthlyWords": 1, "monthlyImages": 2}}},
])
def test_invalid_limit_files_fail_closed(tmp_path, change):
    value = {"period": "calendar_month", "timezone": "UTC", "plans": {
        "free": {"monthlyWords": 1, "monthlyImages": 0}, "pro": {"monthlyWords": 1, "monthlyImages": 2}}}
    value.update(change)
    path = tmp_path / "limits.json"
    path.write_text(json.dumps(value))
    with pytest.raises(RuntimeError, match="Invalid monthly limits"):
        load_limits(path)


@pytest.mark.parametrize("now, month, reset", [
    (datetime(2026, 12, 31, 23, 59, tzinfo=UTC), "2026-12", datetime(2027, 1, 1, tzinfo=UTC)),
    (datetime(2028, 2, 29, 23, 59, tzinfo=UTC), "2028-02", datetime(2028, 3, 1, tzinfo=UTC)),
    (datetime(2026, 4, 30, tzinfo=UTC), "2026-04", datetime(2026, 5, 1, tzinfo=UTC)),
])
def test_calendar_month_utc_reset(now, month, reset):
    assert month_period(now) == (month, reset)


def text_request(text="hello", key="key", segments=None):
    return TranslationRequest(sourceLanguage="auto", targetLanguage="uk", idempotencyKey=key,
                              segments=segments or [{"id": "one", "text": text}])


async def test_plans_are_server_owned_and_text_limits_are_selected_transactionally():
    settings = Settings(mode="memory")
    settings = replace(settings, limits=replace(settings.limits,
        free=replace(settings.limits.free, monthly_words=1),
        pro=replace(settings.limits.pro, monthly_words=3)))
    repository = MemoryRepository()
    store = JobStore(repository, settings, lambda: datetime(2026, 10, 24, tzinfo=UTC))
    with pytest.raises(ApiError, match="QUOTA_EXCEEDED"):
        await store.create("alice", text_request("hello world"))
    repository.documents[store.entitlement_key("alice")] = {"plan": "pro"}
    identifier = await store.create("alice", text_request("hello world"))
    account = await store.get_account("alice")
    assert account["quota"] == {"monthlyWords": 3, "usedWords": 0, "reservedWords": 2,
                                "remainingWords": 1, "resetsAt": "2026-11-01T00:00:00Z"}
    assert account["imageQuota"]["monthlyImages"] == 150
    repository.documents[store.entitlement_key("alice")] = {"plan": "free"}
    downgraded = await store.get_account("alice")
    assert downgraded["quota"]["remainingWords"] == 0
    assert downgraded["imageQuota"]["monthlyImages"] == 5
    assert downgraded["features"]["imageTranslation"] is True
    await store.cancel("alice", identifier)
    assert (await store.get_quota("alice"))["reservedWords"] == 0


async def test_competing_requests_cannot_exceed_final_monthly_word_and_retry_after():
    settings = Settings(mode="memory")
    settings = replace(settings, limits=replace(settings.limits, free=replace(settings.limits.free, monthly_words=1)))
    now = datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC)
    store = JobStore(MemoryRepository(), settings, lambda: now)
    results = await asyncio.gather(*[store.create("alice", text_request(key=str(i))) for i in range(10)], return_exceptions=True)
    assert sum(isinstance(result, str) for result in results) == 1
    errors = [result for result in results if isinstance(result, ApiError)]
    assert len(errors) == 9 and all(error.code == "QUOTA_EXCEEDED" and error.retry_after == 1 for error in errors)
    assert (await store.get_quota("alice"))["reservedWords"] == 1


async def test_text_segments_are_counted_separately_and_no_reset_at_midnight():
    now = datetime(2026, 10, 24, 23, 59, tzinfo=UTC)
    store = JobStore(MemoryRepository(), Settings(mode="memory"), lambda: now)
    await store.create("alice", text_request(segments=[{"id": "a", "text": "hello"}, {"id": "b", "text": "world"}]))
    assert (await store.get_quota("alice"))["reservedWords"] == 2
    now += timedelta(minutes=2)
    assert (await store.get_quota("alice"))["reservedWords"] == 2


async def test_idempotent_retry_across_new_year_cannot_reserve_new_month():
    now = datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC)
    repository = MemoryRepository()
    store = JobStore(repository, Settings(mode="memory"), lambda: now)
    request = text_request("hello world")
    identifier = await store.create("alice", request)
    now += timedelta(seconds=2)
    assert await store.create("alice", request) == identifier
    assert (await store.get_quota("alice"))["reservedWords"] == 0
    claim = await store.claim(identifier, 0)
    await store.finish(claim, translations=[{"id": "one", "text": "привіт світе"}])
    assert repository.documents[store.user_key("alice")]["monthlyUsage"] == {"2026-12": {"used": 2, "reserved": 0}}
    assert (await store.get_quota("alice"))["usedWords"] == 0


@pytest.mark.parametrize("image", [False, True])
@pytest.mark.parametrize("charge", [False, True])
async def test_preupgrade_daily_reservations_settle_in_original_units_only(image, charge):
    now = datetime(2026, 10, 25, 0, 1, tzinfo=UTC)
    repository = MemoryRepository()
    store = JobStore(repository, Settings(mode="memory"), lambda: now)
    identifier = "a" * 32
    amount = 1 if image else 19
    kind = {"kind": "image"} if image else {}
    account = {"usage": {}, "imageUsage": {}, "activeJobs": {identifier: {
        **kind, "day": "2026-10-24", "characters": 19, "expiresAt": now + timedelta(hours=1)}}}
    account["imageUsage" if image else "usage"]["2026-10-24"] = {"used": 2, "reserved": amount}
    account = store.account(account, now)
    job = {"id": identifier, **kind}
    store.settle(account, job, charge=charge)
    assert account["imageUsage" if image else "usage"]["2026-10-24"] == {"used": 2 + (amount if charge else 0), "reserved": 0}
    assert account["monthlyUsage"] == account["monthlyImageUsage"] == {}
    assert account["activeJobs"] == {}


@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("image", [False, True])
def test_expired_reservations_refund_correct_month_or_legacy_day(image, legacy):
    now = datetime(2026, 11, 1, tzinfo=UTC)
    store = JobStore(MemoryRepository(), Settings(mode="memory"), lambda: now)
    amount = 1 if image else 3
    collection = ("imageUsage" if image else "usage") if legacy else ("monthlyImageUsage" if image else "monthlyUsage")
    period = "2026-10-31" if legacy else "2026-10"
    slot = {"kind": "image" if image else "text", "expiresAt": now}
    slot.update({"day": period, "characters": amount} if legacy else {"month": period, "amount": amount})
    account = store.account({collection: {period: {"used": 4, "reserved": amount}}, "activeJobs": {"job": slot}}, now)
    assert account[collection][period] == {"used": 4, "reserved": 0}
    assert not account["activeJobs"]


def test_monthly_counter_retention_keeps_previous_month_for_inflight_work():
    store = JobStore(MemoryRepository(), Settings(mode="memory"))
    counters = {"2026-09": {"used": 2, "reserved": 0}, "2026-10": {"used": 3, "reserved": 1},
                "2026-11": {"used": 4, "reserved": 0}}
    account = store.account({"monthlyUsage": counters, "monthlyImageUsage": counters}, datetime(2026, 11, 1, tzinfo=UTC))
    assert set(account["monthlyUsage"]) == set(account["monthlyImageUsage"]) == {"2026-10", "2026-11"}
