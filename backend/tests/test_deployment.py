"""Deployment targets must never select the production service implicitly."""
import importlib.util
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('translator_deploy', ROOT / 'scripts/deploy_backend.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def test_test_deployment_has_its_own_service_queue_identity_and_manifest():
    staging, live = deploy.target('test'), deploy.target('live')
    for name in ('service', 'queue', 'runtime', 'tasks', 'base', 'manifest'):
        assert staging[name] != live[name], name
    assert staging['service'] == 'ai-translator-api-test'
    config = deploy.environment_values(staging, 'billing-runtime@balubenko-stripe.iam.gserviceaccount.com')
    assert config['BILLING_ENVIRONMENT'] == 'test'
    assert config['TASK_QUEUE_NAME'] == 'translation-jobs-test'
    assert config['TASK_AUDIENCE'] == config['BACKEND_BASE_URL'] == staging['base']
    assert config['BILLING_AUDIENCE'] == staging['base'] + '/internal/billing-sync'
    assert 'API_ACCESS_TOKEN' not in config


def test_environment_is_required_and_dry_run_never_runs_a_cloud_command(monkeypatch, capsys):
    def reject(*args, **kwargs):
        raise AssertionError('A dry run must not invoke gcloud')
    monkeypatch.setattr(deploy, 'run', reject)
    with pytest.raises(SystemExit):
        deploy.main([])
    deploy.main(['--environment', 'test', '--dry-run'])
    assert 'ai-translator-api-test' in capsys.readouterr().out
    with pytest.raises(SystemExit):
        deploy.main(['--environment', 'test', '--skip-build'])
    with pytest.raises(SystemExit):
        deploy.main(['--environment', 'test', '--dry-run', '--image', 'europe-west1-docker.pkg.dev/ai-translator-ext/ai-translator/backend:latest'])


def test_billing_sender_and_task_sender_must_be_distinct():
    staging = deploy.target('test')
    with pytest.raises(ValueError, match='distinct'):
        deploy.environment_values(staging, staging['tasks'])
    with pytest.raises(ValueError, match='dedicated Google'):
        deploy.environment_values(staging, 'user@example.com')
