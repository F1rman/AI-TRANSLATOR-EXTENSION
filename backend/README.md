# Translation job API

Python 3.12 / FastAPI. Production adapters use Firestore transactions and Cloud Tasks; requests from Chrome are short and durable worker requests call the existing AI endpoint.

## Interface

Public routes require a verified Firebase ID token from a verified Google account in `Authorization: Bearer …`:

| Route | Response |
| --- | --- |
| `GET /health` | Public `{ "status": "ok" }` |
| `GET /v1/me` | User display fields, quota, and request limits |
| `POST /v1/translation-jobs` | HTTP 202: job ID, status, quota |
| `GET /v1/translation-jobs/{id}` | Owner-only status and completed segments |
| `DELETE /v1/translation-jobs/{id}` | Owner-only cancellation |

Submission body:

```json
{
  "sourceLanguage": "auto",
  "targetLanguage": "Ukrainian",
  "segments": [{ "id": "paragraph-1", "text": "Hello, world!" }],
  "idempotencyKey": "unique-client-request-key"
}
```

Job statuses: `queued`, `running`, `completed`, `failed`, `cancelled`. Completed results contain `translations: [{id,text}]`. Errors use `{error:{code,message}}`, with `Retry-After` when appropriate. Only the owner can read/cancel a job. Raw prompts and page URLs are not accepted.

Internal `POST /internal/process-job` and `/internal/reconcile` require a Google OIDC token whose audience and verified service-account email match server configuration. Cloud Tasks sends only job ID/generation; text stays in the backend job record.

## Configuration

| Variable | Production value/default |
| --- | --- |
| `BACKEND_MODE` | `firestore` (`memory` for local development only) |
| `FIREBASE_PROJECT_ID` | `ai-translator-ext` |
| `UPSTREAM_API_URL` | `https://balubenko-ai.web.app/api/generate` |
| `API_ACCESS_TOKEN` | Secret Manager injection; never put in extension config |
| `BACKEND_BASE_URL`, `TASK_AUDIENCE` | Canonical deployed Cloud Run base URL |
| `TASK_QUEUE_PROJECT` | `ai-translator-ext` |
| `TASK_QUEUE_LOCATION` | `europe-west1` |
| `TASK_QUEUE_NAME` | `translation-jobs` |
| `TASK_SERVICE_ACCOUNT` | `ai-translator-tasks@ai-translator-ext.iam.gserviceaccount.com` |
| `DAILY_CHARACTER_LIMIT` | `20000` |
| `MAX_SEGMENTS`, `MAX_CHARACTERS_PER_JOB` | `24`, `4000` |
| `MAX_CONCURRENT_JOBS` | `2` |
| `JOB_TTL_SECONDS`, `JOB_LEASE_SECONDS` | `86400`, `120` |

`ALLOW_DEV_AUTH=true` only works with local memory mode and is rejected on Cloud Run. In that explicit mode, local test identities use `Authorization: Bearer dev:local-user`. Do not enable it for deployment.

## Job consistency

Firestore atomically reserves quota, creates the job, and stores the per-owner idempotency mapping. Reusing a key with different content returns `IDEMPOTENCY_CONFLICT`. Success charges the original reservation day once; failure/cancellation releases it. Expiring leases, deterministic generation-based task names, and scheduled reconciliation recover queued or interrupted jobs. Late workers cannot overwrite a newer generation or a cancelled job.

External AI calls cannot provide an exactly-once guarantee across an infrastructure crash. A recovered attempt can call the provider again, while user quota remains protected against duplicate charges.

Collections `translationJobs` and `translationIdempotency` have TTL on `expiresAt`. `translationUsers` stores hashed UID document keys, recent daily counters and active reservations. Direct client Firestore access is denied. Source/translation text is temporary job data; application logs omit it. Firestore TTL is asynchronous.

## Checks

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
backend/.venv/bin/python -m pytest backend/tests -q
backend/.venv/bin/python scripts/smoke_backend.py --base-url https://ai-translator-api-1060412514800.europe-west1.run.app
```

Offline tests use injected adapters and no real tokens. The live smoke creates isolated Firestore fixtures, dispatches real authenticated Cloud Tasks through the upstream AI service, checks deduplication/cancellation, and removes its fixtures. It uses the authorized gcloud identity in memory and never impersonates an application user.

The runtime service account needs Firestore user, Firebase Auth viewer (revocation checks), Cloud Tasks enqueuer, access to the upstream secret, and permission to act as the task caller. The task caller is authorized only for internal handler identity. The image builder has artifact writer, staging-object reader, and log writer permissions. `recover-translation-jobs` runs reconciliation every minute.
