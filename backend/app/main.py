from contextlib import asynccontextmanager
from dataclasses import dataclass
import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .auth import DevelopmentTaskAuth, DevelopmentUserAuth, FirebaseUserAuth, TaskOidcAuth
from .config import Settings
from .dispatcher import CloudTasksDispatcher, MemoryDispatcher
from .models import ApiError, TranslationRequest, WorkerRequest
from .repository import FirestoreRepository, MemoryRepository
from .service import JobStore, TranslationService
from .upstream import HttpUpstream

log = logging.getLogger("translator")


@dataclass
class Runtime:
    settings: Settings
    service: TranslationService
    user_auth: object
    task_auth: object

    async def close(self):
        for component in (self.service.dispatcher, self.service.upstream, self.service.store.repository):
            if hasattr(component, "close"):
                await component.close()


def build_runtime(settings):
    repository = MemoryRepository() if settings.mode == "memory" else FirestoreRepository(settings.project_id)
    dispatcher = MemoryDispatcher() if settings.mode == "memory" else CloudTasksDispatcher(settings)
    service = TranslationService(JobStore(repository, settings), dispatcher, HttpUpstream(settings))
    if settings.mode == "memory":
        dispatcher.handler = service.process
    return Runtime(
        settings, service,
        DevelopmentUserAuth() if settings.allow_dev_auth else FirebaseUserAuth(settings.project_id),
        DevelopmentTaskAuth() if settings.allow_dev_auth else TaskOidcAuth(settings.task_audience, settings.task_service_account),
    )


def create_app(runtime=None, settings=None):
    @asynccontextmanager
    async def lifespan(application):
        selected = runtime or build_runtime(settings or Settings.from_environment())
        application.state.runtime = selected
        try:
            yield
        finally:
            await selected.close()

    application = FastAPI(title="AI Translator API", version="1.0.0", lifespan=lifespan)
    # Injectable runtime also supports ASGI transports that do not run lifespan automatically.
    if runtime:
        application.state.runtime = runtime

    @application.exception_handler(ApiError)
    async def api_error(request, error):
        headers = {"Retry-After": str(error.retry_after)} if error.retry_after else {}
        if error.status == 401:
            headers["WWW-Authenticate"] = "Bearer"
        return JSONResponse({"error": error.public()}, status_code=error.status, headers=headers)

    @application.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Validation errors may contain source text or credentials: never echo them.
        return JSONResponse({"error": {"code": "INVALID_REQUEST", "message": "The request is invalid or exceeds the translation limits."}}, status_code=422)

    @application.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse({"error": {"code": "NOT_FOUND" if error.status_code == 404 else "INVALID_REQUEST",
                                      "message": "The requested operation is unavailable."}}, status_code=error.status_code)

    @application.exception_handler(Exception)
    async def unexpected_error(request, error):
        log.warning("request_failed", extra={"error_type": type(error).__name__})
        return JSONResponse({"error": {"code": "SERVICE_UNAVAILABLE", "message": "The translation service is temporarily unavailable."}}, status_code=503)

    def get_runtime(request: Request):
        return request.app.state.runtime

    async def user(request: Request, current: Runtime = Depends(get_runtime)):
        return await current.user_auth(request.headers.get("Authorization"))

    async def worker(request: Request, current: Runtime = Depends(get_runtime)):
        await current.task_auth(request.headers.get("Authorization"))

    @application.get("/health")
    async def health():
        return {"status": "ok"}

    @application.get("/v1/me")
    async def me(identity=Depends(user), current: Runtime = Depends(get_runtime)):
        config = current.settings
        return {"user": identity, "quota": await current.service.store.get_quota(identity["uid"]),
                "limits": {"maxSegments": config.max_segments, "maxCharactersPerJob": config.max_characters,
                           "maxConcurrentJobs": config.max_concurrent_jobs}}

    @application.post("/v1/translation-jobs", status_code=202)
    async def submit(payload: TranslationRequest, identity=Depends(user), current: Runtime = Depends(get_runtime)):
        return await current.service.submit(identity["uid"], payload)

    JobId = Annotated[str, Path(pattern=r"^[a-f0-9]{32}$")]

    @application.get("/v1/translation-jobs/{job_id}")
    async def get_job(job_id: JobId, identity=Depends(user), current: Runtime = Depends(get_runtime)):
        return await current.service.get(identity["uid"], job_id)

    @application.delete("/v1/translation-jobs/{job_id}")
    async def cancel_job(job_id: JobId, identity=Depends(user), current: Runtime = Depends(get_runtime)):
        return await current.service.cancel(identity["uid"], job_id)

    @application.post("/internal/process-job", dependencies=[Depends(worker)])
    async def process_job(payload: WorkerRequest, current: Runtime = Depends(get_runtime)):
        await current.service.process(payload.jobId, payload.generation)
        return {"status": "ok"}

    @application.post("/internal/reconcile", dependencies=[Depends(worker)])
    async def reconcile(current: Runtime = Depends(get_runtime)):
        return await current.service.reconcile()

    return application


app = create_app()
