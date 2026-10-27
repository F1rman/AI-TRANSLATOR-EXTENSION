import asyncio
import hashlib
import json
import logging
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4
from time import perf_counter

from .images import MemoryImageStorage, validate_image
from .models import ApiError
from .words import count_words
from . import billing, subscriptions

log = logging.getLogger("translator")
TERMINAL = {"completed", "failed", "cancelled"}


def utc_now():
    return datetime.now(UTC)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def month_period(now):
    now = now.astimezone(UTC)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    following = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start.strftime("%Y-%m"), following


class JobStore:
    def __init__(self, repository, settings, clock=utc_now):
        self.repository, self.settings, self.clock = repository, settings, clock

    @staticmethod
    def user_key(uid):
        return ("translationUsers", digest(uid))

    @staticmethod
    def job_key(identifier):
        return ("translationJobs", identifier)

    @staticmethod
    def entitlement_key(uid):
        return ("translationEntitlements", digest(uid))

    @staticmethod
    def subscription_key(uid):
        return ("translationSubscriptions", digest(uid))

    def effective_access(self, documents, uid, now):
        manual_key = self.entitlement_key(uid)
        effective = subscriptions.access(documents.get(manual_key), documents.get(self.subscription_key(uid)), now)
        if effective["source"] == "manual" and effective["anchor"] is None:
            # Existing undated grants get one persisted migration anchor, never a
            # fresh monthly allowance on each read or after a service restart.
            documents[manual_key] = {**documents[manual_key], "quotaAnchorAt": int(now.timestamp())}
            effective["anchor"] = datetime.fromtimestamp(int(now.timestamp()), UTC)
        return effective

    async def sync_subscription(self, payload):
        if payload.environment != self.settings.billing_environment:
            raise ApiError("BILLING_ENVIRONMENT_MISMATCH", "The subscription belongs to another billing environment.", 409)
        if payload.authProjectId != self.settings.project_id:
            raise ApiError("SUBSCRIPTION_IDENTITY_MISMATCH", "The subscription belongs to another authentication project.", 403)
        key = self.subscription_key(payload.uid)
        value = payload.model_dump()
        def sync(documents):
            prior = documents[key]
            if prior:
                for name in ("environment", "productId", "authProjectId", "uid", "policyVersion"):
                    if prior.get(name) != value[name]:
                        raise ApiError("SUBSCRIPTION_CONFLICT", "The subscription identity does not match.", 409)
                if prior["revision"] > value["revision"]:
                    return {"ok": True, "applied": False, "revision": prior["revision"]}, {}
                if prior["revision"] == value["revision"]:
                    if prior != value:
                        raise ApiError("SUBSCRIPTION_CONFLICT", "The subscription revision has conflicting terms.", 409)
                    return {"ok": True, "applied": False, "revision": prior["revision"]}, {}
            return {"ok": True, "applied": True, "revision": value["revision"]}, {key: value}
        return await self.repository.atomic([key], sync)

    async def atomic(self, keys, operation, uid):
        def update(documents):
            before = {key: deepcopy(value) for key, value in billing.purchase_documents(documents)}
            result, updates = operation(documents)
            for key, value in billing.purchase_documents(documents):
                if value != before.get(key):
                    updates[key] = value
            user_key = self.user_key(uid)
            if user_key in updates:
                updates[user_key]["prepaid"] = billing.summary(documents)
            return result, updates
        return await self.repository.atomic(keys, update, purchases_uid=uid,
                                            environment=self.settings.billing_environment)

    async def sync_purchase(self, payload):
        if payload.environment != self.settings.billing_environment:
            raise ApiError("BILLING_ENVIRONMENT_MISMATCH", "The purchase belongs to another billing environment.", 409)
        if payload.authProjectId != self.settings.project_id:
            raise ApiError("PURCHASE_IDENTITY_MISMATCH", "The purchase belongs to another authentication project.", 403)
        uid, now = payload.uid, self.clock()
        key = billing.purchase_key(payload.environment, payload.orderId)
        user_key = self.user_key(uid)
        def sync(documents):
            applied = billing.apply_snapshot(documents, key, payload.model_dump())
            account = self.account(documents[user_key], now, documents)
            return {"ok": True, "applied": applied, "revision": documents[key]["revision"]}, {user_key: account}
        return await self.atomic([key, user_key], sync, uid)

    async def is_pro(self, uid):
        manual, snapshot = await asyncio.gather(self.repository.get(self.entitlement_key(uid)),
                                               self.repository.get(self.subscription_key(uid)))
        return subscriptions.access(manual, snapshot, self.clock())["pro"]

    def image_enabled(self, pro):
        return self.settings.limits.for_plan(pro).monthly_images > 0

    async def require_image_access(self, uid, *, reservation=None):
        current = await self.get_account(uid)
        # Accepted prepaid reservations stay committed even if a refund arrives
        # while the provider is working. Check the server reservation, never input.
        if reservation:
            account = await self.repository.get(self.user_key(uid))
            slot = (account or {}).get("activeJobs", {}).get(reservation.get("id"))
            if slot and slot.get("kind") == "image" and slot.get("prepaid"):
                return
        image_limit = current["imageQuota"]["monthlyImages"]
        if (image_limit <= 0 and current["prepaid"]["images"] <= 0
                and current["prepaid"]["reservedImages"] <= 0):
            # Preserve the existing API code for configurations which disable
            # images in Free. Access is determined by the server's current plan.
            raise ApiError("PRO_REQUIRED", "Image translation is not available with your current plan.", 403)
        if reservation and "month" in reservation:
            account = self.account(account, self.clock())
            usage = account["monthlyImageUsage"].get(reservation["month"], {"used": 0, "reserved": 0})
            if usage["used"] + usage["reserved"] > image_limit:
                _, resets = month_period(self.clock())
                raise ApiError("IMAGE_QUOTA_EXCEEDED", "The monthly image translation allowance has been reached.", 429,
                               max(1, int((resets - self.clock()).total_seconds())))

    @staticmethod
    def reservation_usage(account, slot):
        if slot.get("unit") == "characters":
            return account["characterUsage"], slot["period"], slot["amount"]
        image = slot.get("kind") == "image"
        if "month" in slot:
            return account["monthlyImageUsage" if image else "monthlyUsage"], slot["month"], slot["amount"]
        # Release/charge pre-upgrade jobs in their original day and unit. Daily
        # source characters cannot be converted into an honest word count.
        return account["imageUsage" if image else "usage"], slot["day"], 1 if image else slot["characters"]

    def account(self, value, now, documents=None):
        account = deepcopy(value) if value else {}
        for key in ("usage", "imageUsage", "monthlyUsage", "monthlyImageUsage", "characterUsage", "activeJobs"):
            account.setdefault(key, {})
        for identifier, slot in list(account["activeJobs"].items()):
            if slot["expiresAt"] <= now:
                if slot.get("prepaid") and documents is None:
                    # Pure quota formatting must not release external purchase lots.
                    continue
                counters, period, amount = self.reservation_usage(account, slot)
                usage = counters.get(period)
                if usage:
                    usage["reserved"] = max(0, usage["reserved"] - amount)
                if slot.get("prepaid"):
                    billing.release(documents, slot["prepaid"], charge=False)
                del account["activeJobs"][identifier]
        # Every live reservation expires within 24 hours. Keep a few days for rollover settlement.
        cutoff = (now - timedelta(days=3)).date().isoformat()
        account["usage"] = {day: usage for day, usage in account["usage"].items() if day >= cutoff}
        account["imageUsage"] = {day: usage for day, usage in account["imageUsage"].items() if day >= cutoff}
        month, _ = month_period(now)
        previous = (datetime.strptime(month, "%Y-%m") - timedelta(days=1)).strftime("%Y-%m")
        for key in ("monthlyUsage", "monthlyImageUsage"):
            account[key] = {period: usage for period, usage in account[key].items() if period >= previous}
        # A period key ends with its UTC start. Preserve active reservations even
        # across a plan change, and retain enough history for month-end settlement.
        reserved_periods = {slot["period"] for slot in account["activeJobs"].values() if slot.get("unit") == "characters"}
        character_cutoff = now - timedelta(days=65)
        account["characterUsage"] = {period: usage for period, usage in account["characterUsage"].items()
            if period in reserved_periods or (subscriptions.as_datetime(period.rsplit("Z:", 1)[-1].removeprefix("free:")) or now) >= character_cutoff}
        return account

    def character_quota(self, account, now, effective):
        period, start, end = subscriptions.allowance_period(effective, now)
        usage = account["characterUsage"].get(period, {"used": 0, "reserved": 0})
        limit = self.settings.limits.for_plan(effective["pro"]).monthly_characters
        return {"monthlyCharacters": limit, "usedCharacters": usage["used"],
                "reservedCharacters": usage["reserved"],
                "remainingCharacters": max(0, limit - usage["used"] - usage["reserved"]),
                "periodStart": subscriptions.iso(start), "resetsAt": subscriptions.iso(end)}

    async def get_character_account(self, uid):
        now = self.clock()
        user_key, manual_key, subscription_key = self.user_key(uid), self.entitlement_key(uid), self.subscription_key(uid)
        def public(account, effective):
            return {"plan": "pro" if effective["pro"] else "free",
                    "characterQuota": self.character_quota(account, now, effective),
                    "features": subscriptions.features(effective["pro"]),
                    "limits": {"maxSegments": self.settings.max_segments,
                               "maxCharactersPerJob": self.settings.limits.for_plan(effective["pro"]).max_characters_per_job,
                               "maxConcurrentJobs": self.settings.max_concurrent_jobs}}
        account, manual, snapshot = await asyncio.gather(self.repository.get(user_key), self.repository.get(manual_key),
                                                        self.repository.get(subscription_key))
        effective = subscriptions.access(manual, snapshot, now)
        migrate_anchor = effective["source"] == "manual" and effective["anchor"] is None
        release_purchase = any(slot.get("prepaid") and slot["expiresAt"] <= now
                               for slot in (account or {}).get("activeJobs", {}).values())
        if not migrate_anchor and not release_purchase:
            # Polling does not write counters or query retired purchase lots.
            return public(self.account(account, now), effective)
        def read(documents):
            original_manual = deepcopy(documents.get(manual_key))
            effective = self.effective_access(documents, uid, now)
            account = self.account(documents[user_key], now, documents)
            updates = {user_key: account} if account != documents[user_key] else {}
            if original_manual != documents.get(manual_key):
                updates[manual_key] = documents[manual_key]
            return public(account, effective), updates
        return await self.atomic([user_key, manual_key, subscription_key], read, uid)

    @staticmethod
    def require_character_features(payload, pro):
        if not pro and (payload["mode"] == "page" or payload["tone"] != "neutral" or payload["context"]):
            raise ApiError("PRO_REQUIRED", "This translation feature requires an active Pro subscription.", 403)

    async def create_character(self, uid, request):
        now = self.clock()
        payload = request.model_dump(exclude={"idempotencyKey"})
        payload_hash = digest(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        characters = sum(len(segment["text"]) for segment in payload["segments"])
        identifier = uuid4().hex
        job_key, user_key = self.job_key(identifier), self.user_key(uid)
        manual_key, subscription_key = self.entitlement_key(uid), self.subscription_key(uid)
        idem_key = ("translationIdempotency", digest(uid + "\0v2\0" + request.idempotencyKey))
        def create(documents):
            previous = documents[idem_key]
            if previous and previous["expiresAt"] > now:
                if previous["payloadHash"] != payload_hash:
                    raise ApiError("IDEMPOTENCY_CONFLICT", "This request key was already used for different translation options.", 409)
                return previous["jobId"], {}
            original_manual = deepcopy(documents.get(manual_key))
            effective = self.effective_access(documents, uid, now)
            self.require_character_features(payload, effective["pro"])
            limits = self.settings.limits.for_plan(effective["pro"])
            if characters > limits.max_characters_per_job or len(payload["segments"]) > self.settings.max_segments:
                raise ApiError("INVALID_REQUEST", "The translation job exceeds the current plan request limits.", 422)
            account = self.account(documents[user_key], now, documents)
            quota = self.character_quota(account, now, effective)
            period, _, resets = subscriptions.allowance_period(effective, now)
            if characters > quota["remainingCharacters"]:
                raise ApiError("QUOTA_EXCEEDED", "Your monthly character allowance is used up. Upgrade to Pro or wait for the reset.", 429,
                               max(1, int((resets - now).total_seconds())))
            if len(account["activeJobs"]) >= self.settings.max_concurrent_jobs:
                raise ApiError("CONCURRENCY_LIMIT", "Two translation jobs are already in progress. Try again shortly.", 429, 2)
            expiry = now + timedelta(seconds=self.settings.job_ttl_seconds)
            account["characterUsage"].setdefault(period, {"used": 0, "reserved": 0})["reserved"] += characters
            account["activeJobs"][identifier] = {"kind": "text", "unit": "characters", "period": period,
                                                "amount": characters, "expiresAt": expiry}
            job = {"id": identifier, "uid": uid, "status": "queued", "payload": payload,
                   "payloadHash": payload_hash, "characters": characters, "policyVersion": 2,
                   "tier": "pro" if effective["pro"] else "free", "priority": effective["pro"],
                   "createdAt": now, "updatedAt": now, "expiresAt": expiry,
                   "reservationState": "reserved", "generation": 0, "dispatchState": "pending", "recoverAt": now}
            updates = {job_key: job, user_key: account,
                       idem_key: {"jobId": identifier, "payloadHash": payload_hash, "expiresAt": expiry}}
            if original_manual != documents.get(manual_key):
                updates[manual_key] = documents[manual_key]
            return identifier, updates
        return await self.atomic([job_key, user_key, manual_key, subscription_key, idem_key], create, uid)

    async def require_character_access(self, job):
        current = await self.get_character_account(job["uid"])
        pro = current["plan"] == "pro"
        self.require_character_features(job["payload"], pro)
        if job["characters"] > current["limits"]["maxCharactersPerJob"]:
            raise ApiError("PRO_REQUIRED", "This translation size requires an active Pro subscription.", 403)

    def quota(self, account, now, pro=False):
        account = self.account(account, now)
        month, resets = month_period(now)
        usage = account["monthlyUsage"].get(month, {"used": 0, "reserved": 0})
        limit = self.settings.limits.for_plan(pro).monthly_words
        return {
            "monthlyWords": limit,
            "usedWords": usage["used"],
            "reservedWords": usage["reserved"],
            "remainingWords": max(0, limit - usage["used"] - usage["reserved"]),
            "resetsAt": resets.isoformat().replace("+00:00", "Z"),
        }

    async def get_quota(self, uid):
        return (await self.get_account(uid))["quota"]

    def image_quota(self, account, now, pro=False):
        account = self.account(account, now)
        month, resets = month_period(now)
        usage = account["monthlyImageUsage"].get(month, {"used": 0, "reserved": 0})
        limit = self.settings.limits.for_plan(pro).monthly_images
        return {"monthlyImages": limit, "usedImages": usage["used"],
                "reservedImages": usage["reserved"],
                "remainingImages": max(0, limit - usage["used"] - usage["reserved"]),
                "resetsAt": resets.isoformat().replace("+00:00", "Z")}

    async def get_image_quota(self, uid):
        return (await self.get_account(uid))["imageQuota"]

    async def get_account(self, uid):
        now = self.clock()
        user_key, entitlement_key = self.user_key(uid), self.entitlement_key(uid)
        account, entitlement, snapshot = await asyncio.gather(self.repository.get(user_key), self.repository.get(entitlement_key),
                                                              self.repository.get(self.subscription_key(uid)))
        # Ordinary polling keeps the existing two account reads. Only overdue
        # purchase reservations need a transaction to release their external lots.
        if any(slot.get("prepaid") and slot["expiresAt"] <= now
               for slot in (account or {}).get("activeJobs", {}).values()):
            def cleanup(documents):
                selected = self.account(documents[user_key], now, documents)
                return selected, {user_key: selected}
            account = await self.atomic([user_key], cleanup, uid)
        account = self.account(account, now)
        pro = subscriptions.access(entitlement, snapshot, now)["pro"]
        # Paid text subscriptions do not include the historical image-generation
        # benefit. Only an explicit legacy manual grant selects that allowance.
        image_pro = subscriptions.manual_active(entitlement, now)
        prepaid = account.get("prepaid", {"words": 0, "images": 0, "reservedWords": 0, "reservedImages": 0})
        return {"quota": self.quota(account, now, pro), "plan": "pro" if pro else "free",
                "prepaid": prepaid, "features": {"imageTranslation": self.image_enabled(image_pro)
                    or prepaid["images"] > 0 or prepaid["reservedImages"] > 0},
                "imageQuota": self.image_quota(account, now, image_pro)}

    def settle(self, account, job, *, charge, documents=None):
        slot = account["activeJobs"].pop(job["id"], None)
        if slot:
            counters, period, amount = self.reservation_usage(account, slot)
            usage = counters.setdefault(period, {"used": 0, "reserved": 0})
            usage["reserved"] = max(0, usage["reserved"] - amount)
            if charge:
                usage["used"] += amount
            if slot.get("prepaid"):
                billing.release(documents, slot["prepaid"], charge=charge)
        job["reservationState"] = "charged" if charge and slot else "released"
        job["recoverAt"] = None
        job.pop("leaseToken", None)
        job.pop("leaseUntil", None)

    async def create(self, uid, request):
        now = self.clock()
        payload = request.model_dump(exclude={"idempotencyKey"})
        payload_hash = digest(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        characters = sum(len(segment["text"]) for segment in payload["segments"])
        words = sum(count_words(segment["text"]) for segment in payload["segments"])
        if len(payload["segments"]) > self.settings.max_segments or characters > self.settings.max_characters:
            raise ApiError("INVALID_REQUEST", "The translation job exceeds the request limits.", 422)
        identifier = uuid4().hex
        job_key, user_key, entitlement_key = self.job_key(identifier), self.user_key(uid), self.entitlement_key(uid)
        subscription_key = self.subscription_key(uid)
        idem_key = ("translationIdempotency", digest(uid + "\0" + request.idempotencyKey))

        def create(documents):
            previous = documents[idem_key]
            if previous and previous["expiresAt"] > now:
                if previous["payloadHash"] != payload_hash:
                    raise ApiError("IDEMPOTENCY_CONFLICT", "This request key was already used for different text.", 409)
                return previous["jobId"], {}
            account = self.account(documents[user_key], now, documents)
            pro = subscriptions.access(documents[entitlement_key], documents[subscription_key], now)["pro"]
            quota = self.quota(account, now, pro)
            month, resets = month_period(now)
            if words > quota["remainingWords"] + billing.summary(documents)["words"]:
                raise ApiError("QUOTA_EXCEEDED", "Your monthly word allowance and purchased balance are used up. Buy a package or wait for the monthly reset.", 429,
                               max(1, int((resets - now).total_seconds())))
            if len(account["activeJobs"]) >= self.settings.max_concurrent_jobs:
                raise ApiError("CONCURRENCY_LIMIT", "Two translation jobs are already in progress. Try again shortly.", 429, 2)
            expiry = now + timedelta(seconds=self.settings.job_ttl_seconds)
            monthly_amount = min(words, quota["remainingWords"])
            prepaid = billing.reserve(documents, "words", words - monthly_amount)
            account["monthlyUsage"].setdefault(month, {"used": 0, "reserved": 0})["reserved"] += monthly_amount
            account["activeJobs"][identifier] = {"kind": "text", "month": month, "words": words,
                                                  "amount": monthly_amount, "prepaid": prepaid, "expiresAt": expiry}
            job = {
                "id": identifier, "uid": uid, "status": "queued", "payload": payload,
                "payloadHash": payload_hash, "characters": characters, "words": words, "month": month,
                "createdAt": now, "updatedAt": now, "expiresAt": expiry,
                "reservationState": "reserved", "generation": 0, "dispatchState": "pending", "recoverAt": now,
            }
            idem = {"jobId": identifier, "payloadHash": payload_hash, "expiresAt": expiry}
            return identifier, {job_key: job, user_key: account, idem_key: idem}

        return await self.atomic([job_key, user_key, entitlement_key, subscription_key, idem_key], create, uid)

    async def create_image(self, uid, request, identifier, metadata, image_hash, object_key):
        now = self.clock()
        payload = request.model_dump(exclude={"idempotencyKey"})
        payload_hash = digest(json.dumps({"kind": "image", "imageHash": image_hash, **payload},
                                         ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        job_key, user_key, entitlement_key = self.job_key(identifier), self.user_key(uid), self.entitlement_key(uid)
        subscription_key = self.subscription_key(uid)
        idem_key = ("translationIdempotency", digest(uid + "\0" + request.idempotencyKey))

        def create(documents):
            pro = subscriptions.manual_active(documents[entitlement_key], now)
            previous = documents[idem_key]
            if previous and previous["expiresAt"] > now:
                if previous["payloadHash"] != payload_hash:
                    raise ApiError("IDEMPOTENCY_CONFLICT", "This request key was already used for a different translation.", 409)
                return previous["jobId"], {}
            account = self.account(documents[user_key], now, documents)
            if not self.image_enabled(pro) and billing.summary(documents)["images"] <= 0:
                raise ApiError("PRO_REQUIRED", "Image translation is not available with your current plan.", 403)
            month, resets = month_period(now)
            remaining = self.image_quota(account, now, pro)["remainingImages"]
            if remaining + billing.summary(documents)["images"] < 1:
                raise ApiError("IMAGE_QUOTA_EXCEEDED", "Your monthly image allowance and purchased balance are used up. Buy a package or wait for the monthly reset.", 429,
                               max(1, int((resets - now).total_seconds())))
            if (len(account["activeJobs"]) >= self.settings.max_concurrent_jobs
                    or any(slot.get("kind") == "image" for slot in account["activeJobs"].values())):
                raise ApiError("CONCURRENCY_LIMIT", "An image translation or two translation jobs are already in progress.", 429, 2)
            expiry = now + timedelta(seconds=self.settings.job_ttl_seconds)
            monthly_amount = min(1, remaining)
            prepaid = billing.reserve(documents, "images", 1 - monthly_amount)
            account["monthlyImageUsage"].setdefault(month, {"used": 0, "reserved": 0})["reserved"] += monthly_amount
            account["activeJobs"][identifier] = {"kind": "image", "month": month, "amount": monthly_amount,
                                                  "prepaid": prepaid, "expiresAt": expiry}
            job = {"id": identifier, "uid": uid, "kind": "image", "status": "queued", "payload": payload,
                   "input": {**metadata, "objectKey": object_key}, "payloadHash": payload_hash, "month": month,
                   "createdAt": now, "updatedAt": now, "expiresAt": expiry, "reservationState": "reserved",
                   "generation": 0, "dispatchState": "pending", "recoverAt": now}
            idem = {"jobId": identifier, "payloadHash": payload_hash, "expiresAt": expiry}
            return identifier, {job_key: job, user_key: account, idem_key: idem}
        return await self.atomic([job_key, user_key, entitlement_key, subscription_key, idem_key], create, uid)

    async def owned(self, uid, identifier):
        job = await self.repository.get(self.job_key(identifier))
        if not job or job["uid"] != uid:
            raise ApiError("JOB_NOT_FOUND", "The translation job was not found.", 404)
        if job["expiresAt"] <= self.clock():
            await self.cancel(uid, identifier, expired=True)
            raise ApiError("JOB_EXPIRED", "The translation job has expired. Start a new translation.", 410)
        return job

    async def cancel(self, uid, identifier, expired=False):
        now = self.clock()
        job_key, user_key = self.job_key(identifier), self.user_key(uid)

        def cancel(documents):
            job = documents[job_key]
            if not job or job["uid"] != uid:
                raise ApiError("JOB_NOT_FOUND", "The translation job was not found.", 404)
            if job["status"] in TERMINAL:
                return job, {}
            account = self.account(documents[user_key], now, documents)
            job["status"] = "failed" if expired else "cancelled"
            job["updatedAt"] = now
            if expired:
                job["error"] = {"code": "JOB_EXPIRED", "message": "The translation job has expired."}
            self.settle(account, job, charge=False, documents=documents)
            return job, {job_key: job, user_key: account}

        return await self.atomic([job_key, user_key], cancel, uid)

    async def dispatch_ticket(self, identifier, existing=None):
        now = self.clock()
        existing = existing or await self.repository.get(self.job_key(identifier))
        if not existing:
            return None
        job_key, user_key = self.job_key(identifier), self.user_key(existing["uid"])

        def ticket(documents):
            job = documents[job_key]
            if not job or job["status"] in TERMINAL:
                return None, {}
            if job["expiresAt"] <= now:
                account = self.account(documents[user_key], now, documents)
                job.update(status="failed", updatedAt=now,
                           error={"code": "JOB_EXPIRED", "message": "The translation job has expired."})
                self.settle(account, job, charge=False, documents=documents)
                return None, {job_key: job, user_key: account}
            if job["status"] == "running":
                if job["leaseUntil"] > now:
                    return None, {}
                job.update(status="queued", generation=job["generation"] + 1, dispatchState="pending")
                job.pop("leaseToken", None)
                job.pop("leaseUntil", None)
            elif job["dispatchState"] == "sent":
                if job["recoverAt"] > now:
                    return None, {}
                job.update(generation=job["generation"] + 1, dispatchState="pending")
            job["updatedAt"] = now
            return {"jobId": identifier, "generation": job["generation"], "kind": job.get("kind", "text"),
                    "priority": job.get("priority", False)}, {job_key: job}

        return await self.atomic([job_key, user_key], ticket, existing["uid"])

    async def dispatched(self, identifier, generation):
        now, key = self.clock(), self.job_key(identifier)

        def dispatched(documents):
            job = documents[key]
            if job and job["status"] == "queued" and job["generation"] == generation:
                seconds = self.settings.image_lease_seconds if job.get("kind") == "image" else self.settings.lease_seconds
                job.update(dispatchState="sent", recoverAt=now + timedelta(seconds=seconds))
                return None, {key: job}
            return None, {}

        await self.repository.atomic([key], dispatched)

    async def claim(self, identifier, generation):
        now = self.clock()
        existing = await self.repository.get(self.job_key(identifier))
        if not existing:
            return None
        job_key, user_key = self.job_key(identifier), self.user_key(existing["uid"])

        def claim(documents):
            job = documents[job_key]
            if not job or job["status"] in TERMINAL or (generation is not None and job["generation"] != generation):
                return None, {}
            if job["expiresAt"] <= now:
                account = self.account(documents[user_key], now, documents)
                job.update(status="failed", updatedAt=now,
                           error={"code": "JOB_EXPIRED", "message": "The translation job has expired."})
                self.settle(account, job, charge=False, documents=documents)
                return None, {job_key: job, user_key: account}
            if job["status"] == "running" and job["leaseUntil"] > now:
                raise ApiError("SERVICE_UNAVAILABLE", "The translation job is already running.", 503, 5)
            seconds = self.settings.image_lease_seconds if job.get("kind") == "image" else self.settings.lease_seconds
            lease_until = now + timedelta(seconds=seconds)
            job.update(status="running", leaseToken=uuid4().hex, leaseUntil=lease_until,
                       recoverAt=lease_until, updatedAt=now)
            return job, {job_key: job}

        return await self.atomic([job_key, user_key], claim, existing["uid"])

    async def finish(self, claim, translations=None, error=None, output=None, return_outcome=False):
        now = self.clock()
        job_key, user_key = self.job_key(claim["id"]), self.user_key(claim["uid"])

        def finish(documents):
            job = documents[job_key]
            def outcome(accepted):
                return {"accepted": accepted, "status": job["status"] if job else None,
                        "outputKey": (job.get("output") or {}).get("objectKey") if job else None}
            if not job or job["status"] != "running" or job.get("leaseToken") != claim["leaseToken"]:
                return outcome(False), {}
            account = self.account(documents[user_key], now, documents)
            failure = error
            if job["expiresAt"] <= now:
                failure = {"code": "JOB_EXPIRED", "message": "The translation job has expired."}
            job.update(status="failed" if failure else "completed", updatedAt=now)
            if failure:
                job["error"] = failure
            elif job.get("kind") == "image":
                job["output"] = output
            else:
                job["translations"] = translations
            self.settle(account, job, charge=failure is None, documents=documents)
            return outcome(True), {job_key: job, user_key: account}

        result = await self.atomic([job_key, user_key], finish, claim["uid"])
        return result if return_outcome else result["accepted"]


class TranslationService:
    def __init__(self, store, dispatcher, upstream, images=None):
        self.store, self.dispatcher, self.upstream = store, dispatcher, upstream
        self.images = images or MemoryImageStorage()

    async def ensure_dispatched(self, identifier, existing=None):
        ticket = await self.store.dispatch_ticket(identifier, existing)
        if not ticket:
            if existing and existing.get("kind") == "image" and existing["expiresAt"] <= self.store.clock():
                await self.cleanup_images(identifier)
            return False
        started = perf_counter()
        try:
            if ticket.get("priority"):
                await self.dispatcher.enqueue(ticket["jobId"], ticket["generation"], priority=True)
            elif ticket["kind"] == "image":
                await self.dispatcher.enqueue(ticket["jobId"], ticket["generation"], kind="image")
            else:
                await self.dispatcher.enqueue(ticket["jobId"], ticket["generation"])
        except Exception:
            # The durable pending record is recovered by polling or the scheduled reconciler.
            log.warning("task_enqueue_failed")
            return False
        finally:
            log.info("translation_timing stage=enqueue kind=%s duration_ms=%.1f", ticket["kind"], (perf_counter() - started) * 1000)
        await self.store.dispatched(identifier, ticket["generation"])
        return True

    def require_kind(self, job, kind):
        if job.get("kind", "text") != kind:
            raise ApiError("JOB_NOT_FOUND", "The translation job was not found.", 404)

    async def owned(self, uid, identifier, kind):
        try:
            job = await self.store.owned(uid, identifier)
        except ApiError as error:
            if kind == "image" and error.code == "JOB_EXPIRED":
                await self.cleanup_images(identifier)
            raise
        self.require_kind(job, kind)
        return job

    async def public_job(self, uid, identifier, job=None):
        job = job or await self.store.owned(uid, identifier)
        if job.get("policyVersion") == 2:
            account = await self.store.get_character_account(uid)
            result = {"id": job["id"], "status": job["status"], "characterQuota": account["characterQuota"]}
            if "translations" in job:
                result["translations"] = job["translations"]
            if "error" in job:
                result["error"] = job["error"]
            return result
        image = job.get("kind") == "image"
        account = await self.store.get_account(uid)
        result = {"id": job["id"], "status": job["status"], "prepaid": account["prepaid"]}
        if image:
            result.update(kind="image", imageQuota=account["imageQuota"])
            if job.get("output"):
                result["output"] = {key: value for key, value in job["output"].items() if key != "objectKey"}
        else:
            result["quota"] = account["quota"]
            if "translations" in job:
                result["translations"] = job["translations"]
        if "error" in job:
            result["error"] = job["error"]
        return result

    async def submit(self, uid, request):
        started = perf_counter()
        identifier = await self.store.create(uid, request)
        log.info("translation_timing stage=reserve kind=text duration_ms=%.1f", (perf_counter() - started) * 1000)
        await self.ensure_dispatched(identifier)
        return await self.public_job(uid, identifier)

    async def submit_character(self, uid, request):
        identifier = await self.store.create_character(uid, request)
        await self.ensure_dispatched(identifier)
        return await self.public_job(uid, identifier)

    async def submit_image(self, uid, request, data):
        # Check entitlement before decoding, uploading or reserving any paid operation.
        await self.store.require_image_access(uid)
        metadata = await asyncio.to_thread(validate_image, data, max_bytes=self.store.settings.max_image_bytes,
                                          max_pixels=self.store.settings.max_image_pixels)
        identifier = uuid4().hex
        object_key = f"jobs/{identifier}/original"
        try:
            await self.images.put(object_key, data, metadata["mimeType"])
            selected = await self.store.create_image(uid, request, identifier, metadata,
                                                      hashlib.sha256(data).hexdigest(), object_key)
        except Exception:
            await self.cleanup_images(identifier)
            raise
        if selected != identifier:
            await self.cleanup_images(identifier)
        await self.ensure_dispatched(selected)
        return await self.public_job(uid, selected)

    async def get(self, uid, identifier, kind="text"):
        started = perf_counter()
        job = await self.owned(uid, identifier, kind)
        # Polls read the job, counters and current plan; recovery is exceptional.
        if (job["status"] not in TERMINAL and job.get("recoverAt") is not None
                and job["recoverAt"] <= self.store.clock()):
            await self.ensure_dispatched(identifier, job)
            job = await self.owned(uid, identifier, kind)
        result = await self.public_job(uid, identifier, job)
        log.info("translation_timing stage=poll_firestore kind=%s duration_ms=%.1f", kind, (perf_counter() - started) * 1000)
        return result

    async def cancel(self, uid, identifier, kind="text"):
        job = await self.owned(uid, identifier, kind)
        job = await self.store.cancel(uid, identifier)
        if kind == "image" and job["status"] in {"cancelled", "failed"}:
            await self.cleanup_images(identifier)
        return await self.public_job(uid, identifier, job)

    async def image(self, uid, identifier, variant):
        job = await self.owned(uid, identifier, "image")
        if variant == "original":
            if job["status"] in {"cancelled", "failed"}:
                raise ApiError("IMAGE_UNAVAILABLE", "The image is no longer available. Start a new translation.", 410)
            metadata = job["input"]
        else:
            if job["status"] != "completed" or not job.get("output"):
                raise ApiError("IMAGE_NOT_READY", "The translated image is not ready yet.", 409)
            metadata = job["output"]
        return await self.images.get(metadata["objectKey"]), metadata["mimeType"]

    async def cleanup_images(self, identifier):
        try:
            await self.images.delete_job(identifier)
        except Exception:
            # Storage lifecycle remains the final cleanup guarantee after infrastructure failures.
            log.warning("image_cleanup_failed")

    async def process(self, identifier, generation=None):
        claim = await self.store.claim(identifier, generation)
        if not claim:
            existing = await self.store.repository.get(self.store.job_key(identifier))
            if existing and existing.get("kind") == "image" and existing["status"] in {"failed", "cancelled"}:
                await self.cleanup_images(identifier)
            return
        kind = claim.get("kind", "text")
        log.info("translation_timing stage=queue kind=%s duration_ms=%.1f", kind,
                 max(0, (self.store.clock() - claim["createdAt"]).total_seconds() * 1000))
        started = perf_counter()
        output_key = None
        completion_attempted = False
        try:
            if kind == "image":
                await self.store.require_image_access(claim["uid"], reservation=claim)
                data = await self.images.get(claim["input"]["objectKey"])
                # Cancellation/recovery while downloading must not start another provider operation.
                current = await self.store.repository.get(self.store.job_key(identifier))
                if (not current or current["status"] != "running"
                        or current.get("leaseToken") != claim["leaseToken"]):
                    return
                await self.store.require_image_access(claim["uid"], reservation=claim)
                translated = await self.upstream.translate_image(data, claim["input"]["mimeType"], claim["payload"])
                try:
                    metadata = await asyncio.to_thread(validate_image, translated, max_bytes=40 * 1024 * 1024,
                                                      max_pixels=20_000_000, png_only=True)
                except ApiError:
                    raise ApiError("INVALID_TRANSLATION", "The AI returned an invalid image. Please try again.", 502) from None
                output_key = f"jobs/{identifier}/{claim['leaseToken']}.png"
                await self.images.put(output_key, translated, "image/png")
                # A Firestore commit can succeed while its acknowledgement is lost. Once this
                # starts, exceptions must preserve the object rather than refunding/deleting a
                # potentially completed result. Durable task retries/reconciliation resolve it.
                completion_attempted = True
                outcome = await self.store.finish(claim, output={**metadata, "objectKey": output_key}, return_outcome=True)
                if outcome["status"] == "completed" and outcome["outputKey"] == output_key:
                    pass
                elif outcome["status"] in {"failed", "cancelled"}:
                    await self.cleanup_images(identifier)
                else:
                    await self.images.delete(output_key)
            else:
                if claim.get("policyVersion") == 2:
                    await self.store.require_character_access(claim)
                translations = await self.upstream.translate(claim["payload"])
                await self.store.finish(claim, translations=translations)
        except ApiError as error:
            if completion_attempted:
                log.warning("image_completion_uncertain")
                raise ApiError("SERVICE_UNAVAILABLE", "Image completion is being recovered. Please retry shortly.", 503, 5) from None
            accepted = await self.store.finish(claim, error=error.public())
            if kind == "image":
                if output_key:
                    await self.images.delete(output_key)
                if accepted:
                    await self.cleanup_images(identifier)
        except Exception:
            if completion_attempted:
                log.warning("image_completion_uncertain")
                raise ApiError("SERVICE_UNAVAILABLE", "Image completion is being recovered. Please retry shortly.", 503, 5) from None
            log.warning("upstream_unexpected_failure")
            accepted = await self.store.finish(claim, error={"code": "UPSTREAM_UNAVAILABLE", "message": "Translation is temporarily unavailable."})
            if kind == "image":
                if output_key:
                    await self.images.delete(output_key)
                if accepted:
                    await self.cleanup_images(identifier)
        finally:
            log.info("translation_timing stage=worker_ai_and_storage kind=%s duration_ms=%.1f", kind, (perf_counter() - started) * 1000)

    async def reconcile(self):
        jobs = await self.store.repository.recoverable(self.store.clock())
        dispatched = 0
        for job in jobs:
            try:
                dispatched += int(await self.ensure_dispatched(job["id"], job))
            except Exception:
                log.warning("job_reconciliation_failed")
        return {"scanned": len(jobs), "dispatched": dispatched}
