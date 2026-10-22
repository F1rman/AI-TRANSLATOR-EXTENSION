import asyncio
import hashlib
from .models import ApiError


def bearer(header):
    if not header:
        raise ApiError("AUTH_REQUIRED", "Sign in with Google to translate.", 401)
    parts = header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise ApiError("UNAUTHENTICATED", "Your session is invalid. Please sign in again.", 401)
    return parts[1]


class FirebaseUserAuth:
    def __init__(self, project_id):
        import firebase_admin
        app_name = "translation-" + hashlib.sha256(project_id.encode()).hexdigest()[:16]
        try:
            self.app = firebase_admin.get_app(app_name)
        except ValueError:
            self.app = firebase_admin.initialize_app(options={"projectId": project_id}, name=app_name)

    async def __call__(self, header):
        from firebase_admin import auth
        token = bearer(header)
        try:
            claims = await asyncio.to_thread(auth.verify_id_token, token, app=self.app, check_revoked=True)
        except auth.CertificateFetchError:
            raise ApiError("SERVICE_UNAVAILABLE", "Sign-in verification is temporarily unavailable.", 503) from None
        except (ValueError, auth.InvalidIdTokenError, auth.UserDisabledError):
            raise ApiError("UNAUTHENTICATED", "Your session has expired. Please sign in again.", 401) from None
        except Exception:
            raise ApiError("SERVICE_UNAVAILABLE", "Sign-in verification is temporarily unavailable.", 503) from None
        if claims.get("firebase", {}).get("sign_in_provider") != "google.com" or claims.get("email_verified") is not True:
            raise ApiError("UNAUTHENTICATED", "Sign in with a verified Google account.", 401)
        return {"uid": claims["uid"], **{key: claims.get(key) if isinstance(claims.get(key), str) else None
                                        for key in ("name", "email", "picture")}}


class TaskOidcAuth:
    def __init__(self, audience, service_account):
        import requests
        from cachecontrol import CacheControl
        from google.auth.transport.requests import Request
        self.audience, self.service_account = audience, service_account
        self.request = Request(session=CacheControl(requests.Session()))

    async def __call__(self, header):
        from google.oauth2 import id_token
        token = bearer(header)
        try:
            claims = await asyncio.to_thread(id_token.verify_oauth2_token, token, self.request, audience=self.audience)
        except ValueError:
            raise ApiError("UNAUTHENTICATED", "A valid worker identity is required.", 401) from None
        except Exception:
            raise ApiError("SERVICE_UNAVAILABLE", "Worker identity verification is temporarily unavailable.", 503) from None
        if claims.get("email") != self.service_account or claims.get("email_verified") is not True:
            raise ApiError("UNAUTHENTICATED", "A valid worker identity is required.", 401)


class DevelopmentUserAuth:
    async def __call__(self, header):
        token = bearer(header)
        if not token.startswith("dev:") or not 0 < len(token[4:]) <= 128:
            raise ApiError("UNAUTHENTICATED", "Use a local development identity.", 401)
        return {"uid": token[4:], "name": "Development user", "email": None, "picture": None}


class DevelopmentTaskAuth:
    async def __call__(self, header):
        if bearer(header) != "dev-task":
            raise ApiError("UNAUTHENTICATED", "A valid worker identity is required.", 401)
