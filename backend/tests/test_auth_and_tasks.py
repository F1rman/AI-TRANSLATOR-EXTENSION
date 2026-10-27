from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.auth import FirebaseUserAuth, TaskOidcAuth
from app.config import Settings
from app.dispatcher import CloudTasksDispatcher
from app.models import ApiError


async def test_firebase_auth_verifies_revocation_and_requires_google(monkeypatch):
    from firebase_admin import auth
    claims = {"uid": "alice", "email_verified": True, "email": "alice@example.com", "firebase": {"sign_in_provider": "google.com"}}
    verify = Mock(return_value=claims)
    monkeypatch.setattr(auth, "verify_id_token", verify)
    verifier = FirebaseUserAuth("unit-test-project")
    assert (await verifier("Bearer firebase-id-token"))["uid"] == "alice"
    verify.assert_called_once_with("firebase-id-token", app=verifier.app, check_revoked=True)
    claims["firebase"]["sign_in_provider"] = "password"
    with pytest.raises(ApiError, match="UNAUTHENTICATED"):
        await verifier("Bearer firebase-id-token")
    claims["firebase"]["sign_in_provider"] = "google.com"
    claims["email_verified"] = False
    with pytest.raises(ApiError, match="UNAUTHENTICATED"):
        await verifier("Bearer firebase-id-token")


async def test_firebase_auth_rejects_invalid_expired_or_revoked_tokens(monkeypatch):
    from firebase_admin import auth
    verifier = FirebaseUserAuth("unit-test-project")
    for error in (ValueError("bad"), auth.InvalidIdTokenError("bad"), auth.RevokedIdTokenError("revoked"), auth.UserDisabledError("disabled")):
        monkeypatch.setattr(auth, "verify_id_token", Mock(side_effect=error))
        with pytest.raises(ApiError, match="UNAUTHENTICATED"):
            await verifier("Bearer secret-token")
    with pytest.raises(ApiError, match="AUTH_REQUIRED"):
        await verifier(None)


async def test_task_oidc_uses_distinct_audience_and_principal(monkeypatch):
    from google.oauth2 import id_token
    claims = {"email": "worker@project.iam.gserviceaccount.com", "email_verified": True}
    verify = Mock(return_value=claims)
    monkeypatch.setattr(id_token, "verify_oauth2_token", verify)
    verifier = TaskOidcAuth("https://canonical-service.run.app", "worker@project.iam.gserviceaccount.com")
    await verifier("Bearer google-oidc-token")
    verify.assert_called_once_with("google-oidc-token", verifier.request, audience="https://canonical-service.run.app")
    claims["email"] = "another@project.iam.gserviceaccount.com"
    with pytest.raises(ApiError, match="UNAUTHENTICATED"):
        await verifier("Bearer google-oidc-token")
    monkeypatch.setattr(id_token, "verify_oauth2_token", Mock(side_effect=ValueError("invalid audience or issuer")))
    with pytest.raises(ApiError, match="UNAUTHENTICATED"):
        await verifier("Bearer firebase-user-token")


async def test_cloud_task_is_deduplicated_and_contains_no_source_or_api_token():
    from google.api_core.exceptions import AlreadyExists
    config = Settings(project_id="test", task_project="test", task_location="europe-west1", task_queue="translation-jobs",
                      backend_base_url="https://backend.run.app", task_audience="https://backend.run.app",
                      task_service_account="tasks@test.iam.gserviceaccount.com", api_access_token="private-api-token")
    fake_client = SimpleNamespace(task_path=lambda *parts: "/".join(parts),
                                  queue_path=lambda *parts: "/".join(parts), create_task=AsyncMock())
    dispatcher = CloudTasksDispatcher.__new__(CloudTasksDispatcher)
    dispatcher.settings, dispatcher.client, dispatcher.parent = config, fake_client, "queue-parent"
    await dispatcher.enqueue("a" * 32, 3)
    call = fake_client.create_task.call_args
    assert call.kwargs["retry"] is None
    assert call.kwargs["timeout"] == 20
    task = call.kwargs["request"]["task"]
    assert task["name"].endswith("translate-" + "a" * 32 + "-3")
    assert task["http_request"]["url"] == "https://backend.run.app/internal/process-job"
    assert task["http_request"]["oidc_token"] == {"service_account_email": config.task_service_account, "audience": config.task_audience}
    assert "private-api-token" not in str(task)
    assert set(__import__("json").loads(task["http_request"]["body"])) == {"jobId", "generation"}
    assert task["dispatch_deadline"].seconds == 120
    await dispatcher.enqueue("c" * 32, 0, priority=True)
    priority_task = fake_client.create_task.call_args.kwargs["request"]
    assert priority_task["parent"].endswith('/' + config.pro_task_queue)
    assert '/' + config.pro_task_queue + '/' in priority_task["task"]["name"]
    await dispatcher.enqueue("b" * 32, 0, kind="image")
    assert fake_client.create_task.call_args.kwargs["request"]["task"]["dispatch_deadline"].seconds == 600
    fake_client.create_task.side_effect = AlreadyExists("already queued")
    await dispatcher.enqueue("a" * 32, 3)


def test_production_rejects_local_auth_and_secrets_are_hidden(monkeypatch):
    monkeypatch.setenv("BACKEND_MODE", "memory")
    monkeypatch.setenv("ALLOW_DEV_AUTH", "true")
    monkeypatch.setenv("K_SERVICE", "cloud-run-service")
    with pytest.raises(RuntimeError, match="Development authentication"):
        Settings.from_environment()
    assert "test-secret" not in repr(Settings(api_access_token="test-secret"))
