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
| `POST /v1/image-translation-jobs` | Pro only, multipart `file`, `sourceLanguage`, `targetLanguage`, `idempotencyKey`; HTTP 202 |
| `GET /v1/image-translation-jobs/{id}` | Owner-only image job state and result dimensions |
| `DELETE /v1/image-translation-jobs/{id}` | Owner-only cancellation and file deletion |
| `GET /v1/image-translation-jobs/{id}/image?variant=original\|translated` | Owner-only file bytes, never a public Storage URL |

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

`GET /v1/me` also returns `plan: "free" | "pro"`, `features: {imageTranslation: boolean}` and
`imageQuota: {dailyImages, usedImages, reservedImages, remainingImages, resetsAt}`.
An image job returns `{id, status, kind: "image", imageQuota, output?, error?}`. Its completed
`output` contains `{mimeType: "image/png", width, height, bytes}` without internal object names.
Static PNG/JPEG/WebP uploads are decoded and checked, independently of filename/MIME claims,
with a 10 MiB / 20,000,000 pixel limit. Multipart requests are bounded even without Content-Length.
No image URL fetching is available on the backend.

Internal `POST /internal/process-job` and `/internal/reconcile` require a Google OIDC token whose audience and verified service-account email match server configuration. Cloud Tasks sends only job ID/generation; text stays in the backend job record.

## Configuration

| Variable | Production value/default |
| --- | --- |
| `BACKEND_MODE` | `firestore` (`memory` for local development only) |
| `FIREBASE_PROJECT_ID` | `ai-translator-ext` |
| `UPSTREAM_API_URL` | `https://balubenko-ai.web.app/api/generate` |
| `UPSTREAM_IMAGE_API_URL` | Direct upstream Cloud Run HTTPS URL ending `/api/translate-image` |
| `IMAGE_BUCKET` | Private regional Cloud Storage bucket name |
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
| `DAILY_IMAGE_LIMIT`, `IMAGE_JOB_LEASE_SECONDS` | `5`, `600` |

`ALLOW_DEV_AUTH=true` only works with local memory mode and is rejected on Cloud Run. In that explicit mode, local test identities use `Authorization: Bearer dev:local-user`. Do not enable it for deployment.

## Job consistency

Firestore atomically reserves quota, creates the job, and stores the per-owner idempotency mapping. Reusing a key with different content returns `IDEMPOTENCY_CONFLICT`. Success charges the original reservation day once; failure/cancellation releases it. Expiring leases, deterministic generation-based task names, and scheduled reconciliation recover queued or interrupted jobs. Late workers cannot overwrite a newer generation or a cancelled job.

External AI calls cannot provide an exactly-once guarantee across an infrastructure crash. A recovered attempt can call the provider again, while user quota remains protected against duplicate charges.

Image and text jobs share the same owner concurrency document: at most two active jobs total,
including at most one image job. `imageUsage` contains separate UTC-day counters, so images do
not consume the 20,000 source-character text allowance. One successful image charges one unit;
failure/cancellation returns its reservation. Idempotency includes the image digest and both languages.
The provider receives image multipart requests with a 330-second client timeout; image leases and
Cloud Task dispatch deadlines are 600 seconds. Text retains its 65-second provider timeout and
120-second lease/deadline. Run the backend with a Cloud Run request timeout of at least 600 seconds.

Entitlements are admin-owned documents in `translationEntitlements/{sha256(uid UTF-8)}`.
Only `{plan: "pro"}` grants access; a missing document or `{plan: "free"}` does not. Additional
admin audit fields are allowed. The backend does not trust an email/client flag or expose an
entitlement write route. It checks the entitlement transactionally at reservation and again directly
before the provider call, so revoking access prevents queued image work from incurring a new call.
Revocation cannot interrupt an image operation already accepted by the external provider.

Collections `translationJobs` and `translationIdempotency` have TTL on `expiresAt`. `translationUsers` stores hashed UID document keys, recent daily counters and active reservations. Direct client Firestore access is denied. Source/translation text is temporary job data; application logs omit it. Firestore TTL is asynchronous.

Only image metadata/object keys live in Firestore. Files are private Storage objects under
`jobs/{job-id}/`; originals and results are accessible through authenticated owner-only routes for
24 hours. Set bucket Uniform Bucket-Level Access, Public Access Prevention, and a delete lifecycle
rule for objects aged one day. Do not enable retention locks or versioning; disable soft delete if
the deployment requires permanent removal rather than recoverable soft-deleted objects. Lifecycle
and Firestore TTL cleanup are asynchronous. Failed/cancelled jobs are deleted immediately on a
best-effort basis, with lifecycle as the fallback for infrastructure failures and orphaned writes.
Every provider attempt writes its result to a lease-specific object; stale attempts delete their
own result without overwriting a newer result.

Ordinary job polling uses one job read and one quota read, with no transaction; task recovery runs
only when the stored recovery time is due. Text upstream requests set `profile: "translation"`.
`Server-Timing` exposes numeric auth/handler durations. Application timing logs contain stage,
kind and duration only, without translation text, image bytes, user tokens or API credentials.

## Checks

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
backend/.venv/bin/python -m pytest backend/tests -q
backend/.venv/bin/python scripts/smoke_backend.py --base-url https://ai-translator-api-1060412514800.europe-west1.run.app
```

Offline tests use injected adapters and no real tokens. The live smoke creates isolated Firestore fixtures, dispatches real authenticated Cloud Tasks through the upstream AI service, checks deduplication/cancellation, and removes its fixtures. It uses the authorized gcloud identity in memory and never impersonates an application user.

The runtime service account needs Firestore user, Firebase Auth viewer (revocation checks), Cloud Tasks enqueuer, access to the upstream secret, and permission to act as the task caller. The task caller is authorized only for internal handler identity. The image builder has artifact writer, staging-object reader, and log writer permissions. `recover-translation-jobs` runs reconciliation every minute.

For image jobs add bucket-scoped `roles/storage.objectUser` to the runtime service account, with
no public/anonymous bucket grant. The administrative Pro grant script needs Firebase Auth read
and Firestore write access; those privileges are not shipped in the extension.
