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
| `POST /v1/image-translation-jobs` | Available when the current plan enables images; multipart `file`, `sourceLanguage`, `targetLanguage`, `idempotencyKey`; HTTP 202 |
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
`quota: {monthlyWords, usedWords, reservedWords, remainingWords, resetsAt}` and
`imageQuota: {monthlyImages, usedImages, reservedImages, remainingImages, resetsAt}`.
An image job returns `{id, status, kind: "image", imageQuota, output?, error?}`. Its completed
`output` contains `{mimeType: "image/png", width, height, bytes}` without internal object names.
Static PNG/JPEG/WebP uploads are decoded and checked, independently of filename/MIME claims,
with a 10 MiB / 20,000,000 pixel limit. Multipart requests are bounded even without Content-Length.
No image URL fetching is available on the backend.

Internal `POST /internal/process-job` and `/internal/reconcile` require a Google OIDC token whose audience and verified service-account email match server configuration. Cloud Tasks sends only job ID/generation; text stays in the backend job record.

## Configuration

Edit **[`app/limits.json`](app/limits.json)** to change allowances. This is the only
source of monthly plan limits; deploy/restart the backend after editing it. The file
is validated at startup, including integer values, both plans, `calendar_month` and
`UTC`; malformed configuration stops startup. There are no environment overrides.

| Plan | Words / calendar month | Images / calendar month |
| --- | ---: | ---: |
| Free | 10,000 | 5 |
| Pro | 200,000 | 150 |

The configured values are enforced for each account's server-owned plan. Image
translation is enabled whenever that plan's `monthlyImages` is greater than zero;
Free users can use their five images without Pro. Setting the allowance to zero
disables new image uploads before reading their body (`PRO_REQUIRED` retains the
existing error contract). Exhausted enabled plans return `IMAGE_QUOTA_EXCEEDED`.
Actual requests count source word segments, never converted character usage. Allowance resets
at 00:00 UTC on the first day of each calendar month. Unused allowance does not roll over.

Words use [uniseg 0.10.1 / UAX #29 Unicode boundaries](https://uniseg-py.readthedocs.io/en/latest/wordbreak.html),
counting segments containing at least one letter or number. Apostrophes and combining
marks follow the standard; punctuation, whitespace and emoji alone count zero. Each
submitted text segment is counted separately. This is not dictionary-based language
analysis: Han characters are counted separately, while Katakana runs may stay joined.
The 4,000 source-character / 24-segment per-job safety limit remains unchanged.

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
| `MAX_SEGMENTS`, `MAX_CHARACTERS_PER_JOB` | `24`, `4000` |
| `MAX_CONCURRENT_JOBS` | `2` |
| `JOB_TTL_SECONDS`, `JOB_LEASE_SECONDS` | `86400`, `120` |
| `IMAGE_JOB_LEASE_SECONDS` | `600` |

`ALLOW_DEV_AUTH=true` only works with local memory mode and is rejected on Cloud Run. In that explicit mode, local test identities use `Authorization: Bearer dev:local-user`. Do not enable it for deployment.

## Job consistency

Firestore atomically reads the server-owned plan, reserves quota, creates the job, and stores the per-owner idempotency mapping. Reusing a key with different content returns `IDEMPOTENCY_CONFLICT`. Success charges the original reservation month once; failure/cancellation releases it. Expiring leases, deterministic generation-based task names, and scheduled reconciliation recover queued or interrupted jobs. Late workers cannot overwrite a newer generation or a cancelled job.

External AI calls cannot provide an exactly-once guarantee across an infrastructure crash. A recovered attempt can call the provider again, while user quota remains protected against duplicate charges.

Image and text jobs share the same owner concurrency document: at most two active jobs total,
including at most one image job. `monthlyImageUsage` contains separate UTC-month counters, so images do
not consume the word allowance. One successful image charges one unit;
failure/cancellation returns its reservation. Idempotency includes the image digest and both languages.
The provider receives image multipart requests with a 330-second client timeout; image leases and
Cloud Task dispatch deadlines are 600 seconds. Text retains its 65-second provider timeout and
120-second lease/deadline. Run the backend with a Cloud Run request timeout of at least 600 seconds.

Entitlements are admin-owned documents in `translationEntitlements/{sha256(uid UTF-8)}`.
Only `{plan: "pro"}` selects Pro limits; a missing document or `{plan: "free"}` selects
Free limits. Additional admin audit fields are allowed. The backend does not trust an
email/client flag or expose an entitlement write route. It reads the current plan
transactionally at reservation and checks the configured feature and original-month
usage again before the provider call. Downgrading Pro to Free keeps image access
while the reservation fits the Free allowance; otherwise the queued job fails and
its reservation is released. Plan changes cannot interrupt an image operation already
accepted by the external provider.

Collections `translationJobs` and `translationIdempotency` have TTL on `expiresAt`.
`translationUsers` stores hashed UID document keys, `monthlyUsage`/`monthlyImageUsage`
counters keyed by `YYYY-MM`, and active reservations recording month and amount.
Current and previous month counters are retained for safe rollover settlement. Legacy
`usage`/`imageUsage` day counters and pre-upgrade reservations are settled in their
original day and unit until expiry; historical characters are never converted into
words. Monthly accounting began in 1.1.1; changing plan limits preserves existing usage. Direct client Firestore
access is denied. Source/translation text is temporary job data; application logs omit
it. Firestore TTL is asynchronous.

Only image metadata/object keys live in Firestore. Files are private Storage objects under
`jobs/{job-id}/`; originals and results are accessible through authenticated owner-only routes for
24 hours. Set bucket Uniform Bucket-Level Access, Public Access Prevention, and a delete lifecycle
rule for objects aged one day. Do not enable retention locks or versioning; disable soft delete if
the deployment requires permanent removal rather than recoverable soft-deleted objects. Lifecycle
and Firestore TTL cleanup are asynchronous. Failed/cancelled jobs are deleted immediately on a
best-effort basis, with lifecycle as the fallback for infrastructure failures and orphaned writes.
Every provider attempt writes its result to a lease-specific object; stale attempts delete their
own result without overwriting a newer result.

Ordinary job polling uses one job read, one account read and one current-entitlement read
(the latter two in parallel), with no transaction; task recovery runs
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
