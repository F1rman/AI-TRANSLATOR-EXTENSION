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
    for name in ('service', 'queue', 'proQueue', 'runtime', 'tasks', 'base', 'manifest'):
        assert staging[name] != live[name], name
    assert staging['service'] == 'ai-translator-api-test'
    config = deploy.environment_values(staging, 'billing-runtime@balubenko-stripe.iam.gserviceaccount.com')
    assert config['BILLING_ENVIRONMENT'] == 'test'
    assert config['TASK_QUEUE_NAME'] == 'translation-jobs-test'
    assert config['TASK_AUDIENCE'] == config['BACKEND_BASE_URL'] == staging['base']
    assert config['BILLING_AUDIENCE'] == staging['base'] + '/internal/billing-sync'
    assert 'API_ACCESS_TOKEN' not in config
    assert config['PRO_TASK_QUEUE_NAME'] == 'translation-jobs-pro-test'
    assert config['LEGACY_TEXT_SUBMISSION_ENABLED'] == 'false'


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


def test_queue_configuration_updates_only_selected_free_and_pro_queues(monkeypatch):
    calls = []
    def run(*args, capture=False):
        calls.append(args)
        if capture:
            return '[{"name":"projects/project/locations/europe-west1/queues/translation-jobs-test"}]'
    monkeypatch.setattr(deploy, 'run', run)
    deploy.configure_queues(deploy.target('test'))
    assert calls[1][:4] == ('tasks', 'queues', 'update', 'translation-jobs-test')
    assert '--max-dispatches-per-second=1' in calls[1]
    assert '--max-concurrent-dispatches=2' in calls[1]
    assert calls[2][:4] == ('tasks', 'queues', 'create', 'translation-jobs-pro-test')
    assert '--max-dispatches-per-second=2' in calls[2]
    assert '--max-concurrent-dispatches=4' in calls[2]
