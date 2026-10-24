"""Update the existing sibling AI API while preserving its Secret Manager bindings."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'OpenAI'
if __name__ == '__main__':
    subprocess.run([
        'gcloud', 'run', 'deploy', 'gpt-api', '--source=.',
        '--project=balubenko-ai', '--account=balubenko.ink@gmail.com', '--region=europe-west1',
        '--service-account=gpt-api-runtime@balubenko-ai.iam.gserviceaccount.com',
        '--build-service-account=projects/balubenko-ai/serviceAccounts/gpt-api-builder@balubenko-ai.iam.gserviceaccount.com',
        '--update-env-vars=IMAGE_MODEL=gpt-image-2.5-flare',
        '--allow-unauthenticated', '--min=0', '--max=2', '--concurrency=2',
        '--cpu=1', '--memory=2Gi', '--timeout=600s', '--quiet',
        '--format=value(status.url)',
    ], cwd=SOURCE, check=True)
