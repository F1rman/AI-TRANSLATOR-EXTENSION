import hashlib
import json
import logging
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from .models import ApiError

log = logging.getLogger("translator")
TERMINAL = {"completed", "failed", "cancelled"}


def utc_now():
    return datetime.now(UTC)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class JobStore:
    def __init__(self, repository, settings, clock=utc_now):
        self.repository, self.settings, self.clock = repository, settings, clock

    @staticmethod
    def user_key(uid):
        return ("translationUsers", digest(uid))

    @staticmethod
    def job_key(identifier):
        return ("translationJobs", identifier)

    def account(self, value, now):
        account = deepcopy(value) if value else {"usage": {}, "activeJobs": {}}
        for identifier, slot in list(account["activeJobs"].items()):
            if slot["expiresAt"] <= now:
                usage = account["usage"].get(slot["day"])
                if usage:
                    usage["reserved"] = max(0, usage["reserved"] - slot["characters"])
                del account["activeJobs"][identifier]
        # Every live reservation expires within 24 hours. Keep a few days for rollover settlement.
        cutoff = (now - timedelta(days=3)).date().isoformat()
        account["usage"] = {day: usage for day, usage in account["usage"].items() if day >= cutoff}
        return account

    def quota(self, account, now):
        account = self.account(account, now)
        usage = account["usage"].get(now.date().isoformat(), {"used": 0, "reserved": 0})
        resets = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), UTC)
        return {
            "dailyCharacters": self.settings.daily_characters,
            "usedCharacters": usage["used"],
            "reservedCharacters": usage["reserved"],
            "remainingCharacters": max(0, self.settings.daily_characters - usage["used"] - usage["reserved"]),
            "resetsAt": resets.isoformat().replace("+00:00", "Z"),
        }

    async def get_quota(self, uid):
        return self.quota(await self.repository.get(self.user_key(uid)), self.clock())

    def settle(self, account, job, *, charge):
        slot = account["activeJobs"].pop(job["id"], None)
        if slot:
            usage = account["usage"].setdefault(slot["day"], {"used": 0, "reserved": 0})
            usage["reserved"] = max(0, usage["reserved"] - slot["characters"])
            if charge:
                usage["used"] += slot["characters"]
        job["reservationState"] = "charged" if charge and slot else "released"
        job["recoverAt"] = None
        job.pop("leaseToken", None)
        job.pop("leaseUntil", None)

    async def create(self, uid, request):
        now = self.clock()
        payload = request.model_dump(exclude={"idempotencyKey"})
        payload_hash = digest(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        characters = sum(len(segment["text"]) for segment in payload["segments"])
        if len(payload["segments"]) > self.settings.max_segments or characters > self.settings.max_characters:
            raise ApiError("INVALID_REQUEST", "The translation job exceeds the request limits.", 422)
        identifier = uuid4().hex
        job_key, user_key = self.job_key(identifier), self.user_key(uid)
        idem_key = ("translationIdempotency", digest(uid + "\0" + request.idempotencyKey))

        def create(documents):
            previous = documents[idem_key]
            if previous and previous["expiresAt"] > now:
                if previous["payloadHash"] != payload_hash:
                    raise ApiError("IDEMPOTENCY_CONFLICT", "This request key was already used for different text.", 409)
                return previous["jobId"], {}
            account = self.account(documents[user_key], now)
            quota = self.quota(account, now)
            if characters > quota["remainingCharacters"]:
                midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), UTC)
                raise ApiError("QUOTA_EXCEEDED", "The daily translation allowance has been reached.", 429,
                               max(1, int((midnight - now).total_seconds())))
            if len(account["activeJobs"]) >= self.settings.max_concurrent_jobs:
                raise ApiError("CONCURRENCY_LIMIT", "Two translation jobs are already in progress. Try again shortly.", 429, 2)
            day = now.date().isoformat()
            expiry = now + timedelta(seconds=self.settings.job_ttl_seconds)
            account["usage"].setdefault(day, {"used": 0, "reserved": 0})["reserved"] += characters
            account["activeJobs"][identifier] = {"day": day, "characters": characters, "expiresAt": expiry}
            job = {
                "id": identifier, "uid": uid, "status": "queued", "payload": payload,
                "payloadHash": payload_hash, "characters": characters, "day": day,
                "createdAt": now, "updatedAt": now, "expiresAt": expiry,
                "reservationState": "reserved", "generation": 0, "dispatchState": "pending", "recoverAt": now,
            }
            idem = {"jobId": identifier, "payloadHash": payload_hash, "expiresAt": expiry}
            return identifier, {job_key: job, user_key: account, idem_key: idem}

        return await self.repository.atomic([job_key, user_key, idem_key], create)

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
            account = self.account(documents[user_key], now)
            job["status"] = "failed" if expired else "cancelled"
            job["updatedAt"] = now
            if expired:
                job["error"] = {"code": "JOB_EXPIRED", "message": "The translation job has expired."}
            self.settle(account, job, charge=False)
            return job, {job_key: job, user_key: account}

        return await self.repository.atomic([job_key, user_key], cancel)

    async def dispatch_ticket(self, identifier):
        now = self.clock()
        existing = await self.repository.get(self.job_key(identifier))
        if not existing:
            return None
        job_key, user_key = self.job_key(identifier), self.user_key(existing["uid"])

        def ticket(documents):
            job = documents[job_key]
            if not job or job["status"] in TERMINAL:
                return None, {}
            if job["expiresAt"] <= now:
                account = self.account(documents[user_key], now)
                job.update(status="failed", updatedAt=now,
                           error={"code": "JOB_EXPIRED", "message": "The translation job has expired."})
                self.settle(account, job, charge=False)
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
            return {"jobId": identifier, "generation": job["generation"]}, {job_key: job}

        return await self.repository.atomic([job_key, user_key], ticket)

    async def dispatched(self, identifier, generation):
        now, key = self.clock(), self.job_key(identifier)

        def dispatched(documents):
            job = documents[key]
            if job and job["status"] == "queued" and job["generation"] == generation:
                job.update(dispatchState="sent", recoverAt=now + timedelta(seconds=self.settings.lease_seconds))
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
                account = self.account(documents[user_key], now)
                job.update(status="failed", updatedAt=now,
                           error={"code": "JOB_EXPIRED", "message": "The translation job has expired."})
                self.settle(account, job, charge=False)
                return None, {job_key: job, user_key: account}
            if job["status"] == "running" and job["leaseUntil"] > now:
                raise ApiError("SERVICE_UNAVAILABLE", "The translation job is already running.", 503, 5)
            lease_until = now + timedelta(seconds=self.settings.lease_seconds)
            job.update(status="running", leaseToken=uuid4().hex, leaseUntil=lease_until,
                       recoverAt=lease_until, updatedAt=now)
            return job, {job_key: job}

        return await self.repository.atomic([job_key, user_key], claim)

    async def finish(self, claim, translations=None, error=None):
        now = self.clock()
        job_key, user_key = self.job_key(claim["id"]), self.user_key(claim["uid"])

        def finish(documents):
            job = documents[job_key]
            if not job or job["status"] != "running" or job.get("leaseToken") != claim["leaseToken"]:
                return False, {}
            account = self.account(documents[user_key], now)
            failure = error
            if job["expiresAt"] <= now:
                failure = {"code": "JOB_EXPIRED", "message": "The translation job has expired."}
            job.update(status="failed" if failure else "completed", updatedAt=now)
            if failure:
                job["error"] = failure
            else:
                job["translations"] = translations
            self.settle(account, job, charge=failure is None)
            return True, {job_key: job, user_key: account}

        return await self.repository.atomic([job_key, user_key], finish)


class TranslationService:
    def __init__(self, store, dispatcher, upstream):
        self.store, self.dispatcher, self.upstream = store, dispatcher, upstream

    async def ensure_dispatched(self, identifier):
        ticket = await self.store.dispatch_ticket(identifier)
        if not ticket:
            return False
        try:
            await self.dispatcher.enqueue(ticket["jobId"], ticket["generation"])
        except Exception:
            # The durable pending record is recovered by polling or the scheduled reconciler.
            log.warning("task_enqueue_failed")
            return False
        await self.store.dispatched(identifier, ticket["generation"])
        return True

    async def public_job(self, uid, identifier):
        job = await self.store.owned(uid, identifier)
        result = {"id": job["id"], "status": job["status"], "quota": await self.store.get_quota(uid)}
        for key in ("translations", "error"):
            if key in job:
                result[key] = job[key]
        return result

    async def submit(self, uid, request):
        identifier = await self.store.create(uid, request)
        await self.ensure_dispatched(identifier)
        return await self.public_job(uid, identifier)

    async def get(self, uid, identifier):
        await self.store.owned(uid, identifier)
        await self.ensure_dispatched(identifier)
        return await self.public_job(uid, identifier)

    async def cancel(self, uid, identifier):
        await self.store.owned(uid, identifier)
        await self.store.cancel(uid, identifier)
        return await self.public_job(uid, identifier)

    async def process(self, identifier, generation=None):
        claim = await self.store.claim(identifier, generation)
        if not claim:
            return
        try:
            translations = await self.upstream.translate(claim["payload"])
        except ApiError as error:
            await self.store.finish(claim, error=error.public())
        except Exception:
            log.warning("upstream_unexpected_failure")
            await self.store.finish(claim, error={"code": "UPSTREAM_UNAVAILABLE", "message": "Translation is temporarily unavailable."})
        else:
            await self.store.finish(claim, translations=translations)

    async def reconcile(self):
        jobs = await self.store.repository.recoverable(self.store.clock())
        dispatched = 0
        for job in jobs:
            try:
                dispatched += int(await self.ensure_dispatched(job["id"]))
            except Exception:
                log.warning("job_reconciliation_failed")
        return {"scanned": len(jobs), "dispatched": dispatched}
