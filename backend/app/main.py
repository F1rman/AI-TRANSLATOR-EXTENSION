from contextlib import asynccontextmanager
from dataclasses import dataclass
import logging
from time import perf_counter
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, Path, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException

from .auth import DevelopmentTaskAuth, DevelopmentUserAuth, FirebaseUserAuth, TaskOidcAuth
from .config import Settings
from .dispatcher import CloudTasksDispatcher, MemoryDispatcher
from .images import CloudImageStorage, MemoryImageStorage
from .models import ApiError, ImageTranslationRequest, TranslationRequest, WorkerRequest
from .logging_config import configure_logging
from .repository import FirestoreRepository, MemoryRepository
from .service import JobStore, TranslationService
from .upstream import HttpUpstream

log = logging.getLogger("translator")
configure_logging()


@dataclass
class Runtime:
    settings: Settings
    service: TranslationService
    user_auth: object
    task_auth: object

    async def close(self):
        for component in (self.service.dispatcher, self.service.upstream, self.service.store.repository, self.service.images):
            if hasattr(component, "close"):
                await component.close()


def build_runtime(settings):
    repository = MemoryRepository() if settings.mode == "memory" else FirestoreRepository(settings.project_id)
    dispatcher = MemoryDispatcher() if settings.mode == "memory" else CloudTasksDispatcher(settings)
    images = MemoryImageStorage() if settings.mode == "memory" else CloudImageStorage(settings.project_id, settings.image_bucket)
    service = TranslationService(JobStore(repository, settings), dispatcher, HttpUpstream(settings), images)
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

    application = FastAPI(title="AI Translator API", version="1.1.2", lifespan=lifespan)
    # Injectable runtime also supports ASGI transports that do not run lifespan automatically.
    if runtime:
        application.state.runtime = runtime

    @application.middleware("http")
    async def timing_and_upload_limit(request, call_next):
        started = perf_counter()
        oversized = False
        maximum = request.app.state.runtime.settings.max_image_bytes + 64 * 1024
        if request.method == "POST" and request.url.path == "/v1/image-translation-jobs":
            # Dependencies run after multipart parsing. Authenticate and check plan access before reading
            # even the first upload byte, then reuse the verified identity in the route dependency.
            auth_started = perf_counter()
            try:
                selected = request.app.state.runtime
                identity = await selected.user_auth(request.headers.get("Authorization"))
                request.state.auth_ms = (perf_counter() - auth_started) * 1000
                await selected.service.store.require_image_access(identity["uid"])
                request.state.verified_identity = identity
            except ApiError as error:
                return await api_error(request, error)
            finally:
                log.info("translation_timing stage=auth duration_ms=%.1f", getattr(request.state, "auth_ms", (perf_counter() - auth_started) * 1000))
            try:
                declared = int(request.headers.get("content-length", "0"))
            except ValueError:
                declared = maximum + 1
            if declared > maximum:
                return JSONResponse({"error": {"code": "INVALID_IMAGE", "message": "Choose an image up to 10 MB."}}, status_code=413)
            received = 0
            original_receive = request._receive

            async def bounded_receive():
                nonlocal received, oversized
                message = await original_receive()
                received += len(message.get("body", b""))
                if received > maximum:
                    oversized = True
                    # Multipart parser closes its temporary files on this exception.
                    raise MultiPartException("Image upload exceeds the request limit")
                return message
            request._receive = bounded_receive
        response = await call_next(request)
        if oversized:
            response = JSONResponse({"error": {"code": "INVALID_IMAGE", "message": "Choose an image up to 10 MB."}}, status_code=413)
        total = (perf_counter() - started) * 1000
        auth_ms = getattr(request.state, "auth_ms", 0)
        response.headers["Server-Timing"] = f"auth;dur={auth_ms:.1f}, handler;dur={max(0, total - auth_ms):.1f}"
        response.headers["Cache-Control"] = "no-store"
        return response

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
        code = "NOT_FOUND" if error.status_code == 404 else "INVALID_IMAGE" if error.status_code == 413 else "INVALID_REQUEST"
        return JSONResponse({"error": {"code": code,
                                      "message": "The requested operation is unavailable."}}, status_code=error.status_code)

    @application.exception_handler(Exception)
    async def unexpected_error(request, error):
        log.warning("request_failed", extra={"error_type": type(error).__name__})
        return JSONResponse({"error": {"code": "SERVICE_UNAVAILABLE", "message": "The translation service is temporarily unavailable."}}, status_code=503)

    def get_runtime(request: Request):
        return request.app.state.runtime

    async def user(request: Request, current: Runtime = Depends(get_runtime)):
        if hasattr(request.state, "verified_identity"):
            return request.state.verified_identity
        started = perf_counter()
        try:
            return await current.user_auth(request.headers.get("Authorization"))
        finally:
            request.state.auth_ms = (perf_counter() - started) * 1000
            log.info("translation_timing stage=auth duration_ms=%.1f", request.state.auth_ms)

    async def worker(request: Request, current: Runtime = Depends(get_runtime)):
        await current.task_auth(request.headers.get("Authorization"))

    @application.get("/health")
    async def health():
        return {"status": "ok"}

    @application.get("/v1/me")
    async def me(identity=Depends(user), current: Runtime = Depends(get_runtime)):
        config = current.settings
        return {"user": identity, **await current.service.store.get_account(identity["uid"]),
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

    @application.post("/v1/image-translation-jobs", status_code=202)
    async def submit_image(file: Annotated[UploadFile, File()], sourceLanguage: Annotated[str, Form()],
                           targetLanguage: Annotated[str, Form()], idempotencyKey: Annotated[str, Form()],
                           identity=Depends(user), current: Runtime = Depends(get_runtime)):
        try:
            payload = ImageTranslationRequest(sourceLanguage=sourceLanguage, targetLanguage=targetLanguage,
                                              idempotencyKey=idempotencyKey)
        except ValidationError:
            raise ApiError("INVALID_REQUEST", "Choose valid source and target languages and a request key.", 422) from None
        try:
            # Read only a bounded number of bytes; never trust filenames or the submitted MIME type.
            data = await file.read(current.settings.max_image_bytes + 1)
            return await current.service.submit_image(identity["uid"], payload, data)
        finally:
            await file.close()

    @application.get("/v1/image-translation-jobs/{job_id}")
    async def get_image_job(job_id: JobId, identity=Depends(user), current: Runtime = Depends(get_runtime)):
        return await current.service.get(identity["uid"], job_id, kind="image")

    @application.delete("/v1/image-translation-jobs/{job_id}")
    async def cancel_image_job(job_id: JobId, identity=Depends(user), current: Runtime = Depends(get_runtime)):
        return await current.service.cancel(identity["uid"], job_id, kind="image")

    @application.get("/v1/image-translation-jobs/{job_id}/image")
    async def image_file(job_id: JobId, variant: Literal["original", "translated"] = "translated",
                         identity=Depends(user), current: Runtime = Depends(get_runtime)):
        data, mime = await current.service.image(identity["uid"], job_id, variant)
        return Response(data, media_type=mime, headers={"Cache-Control": "private, no-store",
                        "Content-Disposition": 'attachment; filename="ai-translator.png"' if variant == "translated" else "inline",
                        "X-Content-Type-Options": "nosniff"})

    @application.post("/internal/process-job", dependencies=[Depends(worker)])
    async def process_job(payload: WorkerRequest, current: Runtime = Depends(get_runtime)):
        await current.service.process(payload.jobId, payload.generation)
        return {"status": "ok"}

    @application.post("/internal/reconcile", dependencies=[Depends(worker)])
    async def reconcile(current: Runtime = Depends(get_runtime)):
        return await current.service.reconcile()

    return application


app = create_app()
