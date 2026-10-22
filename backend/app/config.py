from dataclasses import dataclass, field
import os


@dataclass(frozen=True)
class Settings:
    mode: str = "firestore"
    project_id: str = ""
    upstream_url: str = "https://balubenko-ai.web.app/api/generate"
    api_access_token: str = field(default="", repr=False)
    backend_base_url: str = ""
    task_project: str = ""
    task_location: str = "europe-west1"
    task_queue: str = "translation-jobs"
    task_service_account: str = ""
    task_audience: str = ""
    daily_characters: int = 20_000
    max_segments: int = 24
    max_characters: int = 4_000
    max_concurrent_jobs: int = 2
    job_ttl_seconds: int = 86_400
    lease_seconds: int = 120
    allow_dev_auth: bool = False

    @classmethod
    def from_environment(cls):
        def number(name, default):
            value = int(os.environ.get(name, default))
            if value < 1:
                raise RuntimeError(f"{name} must be positive")
            return value

        project = os.environ.get("FIREBASE_PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT", "")
        base_url = os.environ.get("BACKEND_BASE_URL", "").rstrip("/")
        settings = cls(
            mode=os.environ.get("BACKEND_MODE", "firestore"),
            project_id=project,
            upstream_url=os.environ.get("UPSTREAM_API_URL", cls.upstream_url),
            api_access_token=os.environ.get("API_ACCESS_TOKEN", "").strip(),
            backend_base_url=base_url,
            task_project=os.environ.get("TASK_QUEUE_PROJECT", project),
            task_location=os.environ.get("TASK_QUEUE_LOCATION", "europe-west1"),
            task_queue=os.environ.get("TASK_QUEUE_NAME", "translation-jobs"),
            task_service_account=os.environ.get("TASK_SERVICE_ACCOUNT", ""),
            task_audience=os.environ.get("TASK_AUDIENCE", base_url),
            daily_characters=number("DAILY_CHARACTER_LIMIT", 20_000),
            max_segments=number("MAX_SEGMENTS", 24),
            max_characters=number("MAX_CHARACTERS_PER_JOB", 4_000),
            max_concurrent_jobs=number("MAX_CONCURRENT_JOBS", 2),
            job_ttl_seconds=number("JOB_TTL_SECONDS", 86_400),
            lease_seconds=number("JOB_LEASE_SECONDS", 120),
            allow_dev_auth=os.environ.get("ALLOW_DEV_AUTH", "false").lower() == "true",
        )
        if settings.mode not in {"firestore", "memory"}:
            raise RuntimeError("BACKEND_MODE must be firestore or memory")
        if settings.allow_dev_auth and (settings.mode != "memory" or os.environ.get("K_SERVICE")):
            raise RuntimeError("Development authentication is allowed only in local memory mode")
        if settings.mode == "firestore":
            required = {
                "FIREBASE_PROJECT_ID": settings.project_id,
                "API_ACCESS_TOKEN": settings.api_access_token,
                "BACKEND_BASE_URL": settings.backend_base_url,
                "TASK_QUEUE_PROJECT": settings.task_project,
                "TASK_SERVICE_ACCOUNT": settings.task_service_account,
                "TASK_AUDIENCE": settings.task_audience,
            }
            for name, value in required.items():
                if not value:
                    raise RuntimeError(f"{name} is required")
            if not settings.backend_base_url.startswith("https://") or not settings.upstream_url.startswith("https://"):
                raise RuntimeError("Production service URLs must use HTTPS")
        return settings
