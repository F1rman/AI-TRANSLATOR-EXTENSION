"""Deploy an already provisioned AI Translator backend (no credentials in arguments)."""
import json
from pathlib import Path
import subprocess
from cloud_support import ACCOUNT, PROJECT, REGION

ROOT = Path(__file__).resolve().parent.parent
SERVICE = 'ai-translator-api'
BASE = 'https://ai-translator-api-1060412514800.europe-west1.run.app'
IMAGE = f'{REGION}-docker.pkg.dev/{PROJECT}/ai-translator/backend:latest'
RUNTIME = f'ai-translator-runtime@{PROJECT}.iam.gserviceaccount.com'
TASKS = f'ai-translator-tasks@{PROJECT}.iam.gserviceaccount.com'


def run(*args):
    subprocess.run(['gcloud', *args, f'--project={PROJECT}', f'--account={ACCOUNT}', '--quiet'], cwd=ROOT, check=True)


if __name__ == '__main__':
    run('builds', 'submit', 'backend', '--config=infra/cloudbuild.yaml',
        f'--substitutions=_IMAGE={IMAGE}',
        f'--service-account=projects/{PROJECT}/serviceAccounts/ai-translator-build@{PROJECT}.iam.gserviceaccount.com',
        '--region='+REGION)
    values = {
        'BACKEND_MODE': 'firestore', 'FIREBASE_PROJECT_ID': PROJECT,
        'BACKEND_BASE_URL': BASE, 'TASK_AUDIENCE': BASE,
        'TASK_QUEUE_PROJECT': PROJECT, 'TASK_QUEUE_LOCATION': REGION,
        'TASK_QUEUE_NAME': 'translation-jobs', 'TASK_SERVICE_ACCOUNT': TASKS,
        'UPSTREAM_API_URL': 'https://gpt-api-kldxufmrdq-ew.a.run.app/api/generate',
        'UPSTREAM_IMAGE_API_URL': 'https://gpt-api-kldxufmrdq-ew.a.run.app/api/translate-image',
        'IMAGE_BUCKET': 'ai-translator-ext-images', 'DAILY_IMAGE_LIMIT': '5',
        'IMAGE_JOB_LEASE_SECONDS': '600',
        'DAILY_CHARACTER_LIMIT': '20000', 'MAX_SEGMENTS': '24',
        'MAX_CHARACTERS_PER_JOB': '4000', 'MAX_CONCURRENT_JOBS': '2',
        'JOB_TTL_SECONDS': '86400', 'JOB_LEASE_SECONDS': '120',
    }
    run('run', 'deploy', SERVICE, f'--image={IMAGE}', f'--region={REGION}',
        f'--service-account={RUNTIME}', '--allow-unauthenticated',
        '--set-env-vars='+','.join(f'{key}={value}' for key,value in values.items()),
        '--set-secrets=API_ACCESS_TOKEN=upstream-api-access-token:latest',
        '--timeout=600', '--concurrency=8', '--cpu=1', '--memory=2Gi',
        '--min-instances=0', '--max-instances=2')
    deployment_file = ROOT/'deployment.json'
    previous = json.loads(deployment_file.read_text()) if deployment_file.exists() else {}
    deployment_file.write_text(json.dumps({**previous,
        'projectId': PROJECT, 'region': REGION, 'apiBaseUrl': BASE,
        'hostingUrl': 'https://ai-translator-ext.web.app',
        'firebaseAppId': '1:1060412514800:web:c02c6ef48ae7066d94bd35',
        'service': SERVICE, 'queue': 'translation-jobs',
        'imageBucket': 'ai-translator-ext-images', 'dailyImages': 5,
        'backendVersion': '1.1.0',
    }, indent=2)+'\n')
