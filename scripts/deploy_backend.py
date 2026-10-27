"""Deploy an explicitly selected environment without touching another service.

Provision the environment's service accounts, task queue, IAM and indexes first.
Secrets are passed only by Secret Manager reference, never fetched by this script.
"""
import argparse
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import subprocess

from cloud_support import ACCOUNT, PROJECT, REGION

ROOT = Path(__file__).resolve().parent.parent
PROJECT_NUMBER = '1060412514800'


def target(environment):
    testing = environment == 'test'
    service = 'ai-translator-api-test' if testing else 'ai-translator-api'
    return {
        'environment': environment,
        'service': service,
        'base': f'https://{service}-{PROJECT_NUMBER}.{REGION}.run.app',
        'queue': 'translation-jobs-test' if testing else 'translation-jobs',
        'proQueue': 'translation-jobs-pro-test' if testing else 'translation-jobs-pro',
        'runtime': f'ai-translator-{"test-" if testing else ""}runtime@{PROJECT}.iam.gserviceaccount.com',
        'tasks': f'ai-translator-{"test-" if testing else ""}tasks@{PROJECT}.iam.gserviceaccount.com',
        'manifest': 'deployment.test.json' if testing else 'deployment.json',
    }


def environment_values(selected, billing_sender=None):
    values = {
        'BACKEND_MODE': 'firestore', 'FIREBASE_PROJECT_ID': PROJECT,
        'BACKEND_BASE_URL': selected['base'], 'TASK_AUDIENCE': selected['base'],
        'TASK_QUEUE_PROJECT': PROJECT, 'TASK_QUEUE_LOCATION': REGION,
        'TASK_QUEUE_NAME': selected['queue'], 'TASK_SERVICE_ACCOUNT': selected['tasks'],
        'PRO_TASK_QUEUE_NAME': selected['proQueue'],
        'UPSTREAM_API_URL': 'https://gpt-api-kldxufmrdq-ew.a.run.app/api/generate',
        'UPSTREAM_IMAGE_API_URL': 'https://gpt-api-kldxufmrdq-ew.a.run.app/api/translate-image',
        'IMAGE_BUCKET': 'ai-translator-ext-images',
        'IMAGE_JOB_LEASE_SECONDS': '600', 'MAX_SEGMENTS': '24',
        'MAX_CHARACTERS_PER_JOB': '4000', 'MAX_CONCURRENT_JOBS': '2',
        'JOB_TTL_SECONDS': '86400', 'JOB_LEASE_SECONDS': '120',
        'BILLING_ENVIRONMENT': selected['environment'],
        'LEGACY_TEXT_SUBMISSION_ENABLED': 'false',
    }
    if billing_sender:
        if not billing_sender.endswith('.iam.gserviceaccount.com'):
            raise ValueError('Use a dedicated Google service account email for the billing sender')
        if billing_sender == selected['tasks']:
            raise ValueError('Billing and queue workers require distinct service accounts')
        values['BILLING_SERVICE_ACCOUNT'] = billing_sender
        values['BILLING_AUDIENCE'] = selected['base'] + '/internal/billing-sync'
    return values


def run(*args, capture=False):
    result = subprocess.run(['gcloud', *args, f'--project={PROJECT}', f'--account={ACCOUNT}', '--quiet'],
                            cwd=ROOT, check=True, capture_output=capture, text=True)
    return result.stdout.strip() if capture else None


def configure_queues(selected):
    """Only change the two queues belonging to the explicitly selected target."""
    existing = json.loads(run('tasks', 'queues', 'list', '--location=' + REGION, '--format=json', capture=True))
    names = {item['name'].rsplit('/', 1)[-1] for item in existing}
    for name, rate, concurrent in ((selected['queue'], 1, 2), (selected['proQueue'], 2, 4)):
        operation = 'update' if name in names else 'create'
        run('tasks', 'queues', operation, name, '--location=' + REGION,
            f'--max-dispatches-per-second={rate}', f'--max-concurrent-dispatches={concurrent}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', choices=['test', 'live'], required=True,
                        help='Required; test deploys a distinct service/queue and never updates production')
    parser.add_argument('--image', help='Existing tagged image to deploy when --skip-build is used')
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--billing-sender', default=os.environ.get('BILLING_SERVICE_ACCOUNT'),
                        help='Dedicated central runtime service account; no key file')
    parser.add_argument('--dry-run', action='store_true', help='Print public target configuration without changing cloud state')
    parser.add_argument('--allow-legacy-text-submissions', action='store_true',
                        help='Temporary staged rollout only; permits v1 word jobs until the new extension is available')
    args = parser.parse_args(argv)
    selected = target(args.environment)
    stamp = datetime.now(UTC).strftime('%Y%m%d%H%M%S')
    image = args.image or f'{REGION}-docker.pkg.dev/{PROJECT}/ai-translator/backend:{args.environment}-{stamp}'
    prefix = f'{REGION}-docker.pkg.dev/{PROJECT}/ai-translator/backend:'
    if not image.startswith(prefix) or image.endswith(':latest'):
        parser.error('Use a tagged backend image in this project; latest is not an environment deployment target')
    if args.skip_build and not args.image:
        parser.error('--skip-build requires --image')
    values = environment_values(selected, args.billing_sender)
    if args.allow_legacy_text_submissions:
        values['LEGACY_TEXT_SUBMISSION_ENABLED'] = 'true'
    if args.dry_run:
        print(json.dumps({**selected, 'image': image, 'env': values,
                          'secretRefs': {'API_ACCESS_TOKEN': 'upstream-api-access-token:latest'}}, indent=2))
        return
    configure_queues(selected)
    if not args.skip_build:
        run('builds', 'submit', 'backend', '--config=infra/cloudbuild.yaml',
            f'--substitutions=_IMAGE={image}',
            f'--service-account=projects/{PROJECT}/serviceAccounts/ai-translator-build@{PROJECT}.iam.gserviceaccount.com',
            '--region=' + REGION)
    # update-env-vars retains an existing configured billing sender when omitted.
    run('run', 'deploy', selected['service'], f'--image={image}', f'--region={REGION}',
        f'--service-account={selected["runtime"]}', '--allow-unauthenticated',
        '--update-env-vars=' + ','.join(f'{key}={value}' for key, value in values.items()),
        '--set-secrets=API_ACCESS_TOKEN=upstream-api-access-token:latest',
        '--timeout=600', '--concurrency=8', '--cpu=1', '--memory=2Gi',
        '--min-instances=0', '--max-instances=2')
    ready = json.loads(run('run', 'services', 'describe', selected['service'], f'--region={REGION}',
                           '--format=json', capture=True))
    deployment_file = ROOT / selected['manifest']
    previous = json.loads(deployment_file.read_text()) if deployment_file.exists() else {}
    limits = json.loads((ROOT / 'backend/app/limits.json').read_text())
    deployment_file.write_text(json.dumps({**previous,
        'projectId': PROJECT, 'region': REGION, 'apiBaseUrl': selected['base'],
        'canonicalServiceUrl': ready['status']['url'], 'environment': args.environment,
        'service': selected['service'], 'queue': selected['queue'], 'proQueue': selected['proQueue'], 'image': image,
        'runtimeServiceAccount': selected['runtime'], 'taskServiceAccount': selected['tasks'],
        'billingAudience': values.get('BILLING_AUDIENCE'),
        'hostingUrl': 'https://ai-translator-ext.web.app',
        'firebaseAppId': '1:1060412514800:web:c02c6ef48ae7066d94bd35',
        'imageBucket': 'ai-translator-ext-images', 'quotaLimits': limits, 'backendVersion': '2.0.0',
    }, indent=2) + '\n')
    print(json.dumps({'service': selected['service'], 'url': selected['base'], 'manifest': selected['manifest']}))


if __name__ == '__main__':
    main()
