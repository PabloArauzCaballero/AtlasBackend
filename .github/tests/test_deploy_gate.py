"""Ejercita el paso real de deploy con respuestas HTTP controladas, sin tocar Coolify."""

import os
import pathlib
import subprocess
import tempfile

import yaml

target = 'a' * 40
mock_curl = '''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
url = args[-1]
output = args[args.index('--output') + 1]
method = args[args.index('--request') + 1] if '--request' in args else 'GET'
scenario = os.environ['MOCK_SCENARIO']
target = os.environ['TARGET_SHA']
status = 200
body = {}
if 'api.github.com/' in url:
    body = {'object': {'sha': ('b' * 40 if scenario == 'stale' else target)}}
elif '/deployments/applications/' in url:
    status = 403 if scenario == 'no_read' else 200
    body = {'deployments': []}
elif method == 'POST' and '/api/v1/deploy?' in url:
    pathlib.Path(os.environ['MOCK_POST_LOG']).write_text('POST')
    body = {'deployments': [{'deployment_uuid': 'dep-1', 'message': 'queued'}]}
elif '/deployments/dep-1' in url:
    body = {'status': 'finished', 'commit': ('c' * 40 if scenario == 'mismatch' else target)}
else:
    raise SystemExit('Unexpected URL: ' + url)
pathlib.Path(output).write_text(json.dumps(body))
sys.stdout.write(str(status))
'''

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    workflow = yaml.safe_load(pathlib.Path('.github/workflows/deploy-dev.yml').read_text())
    ci = yaml.safe_load(pathlib.Path('.github/workflows/ci.yml').read_text())
    deploy_events = workflow.get('on', workflow.get(True))
    ci_events = ci.get('on', ci.get(True))
    assert set(deploy_events) == {'workflow_call'}, deploy_events
    assert 'dev' in ci_events['push']['branches'], ci_events
    assert 'dev' in ci_events['pull_request']['branches'], ci_events
    caller = ci['jobs']['deploy-dev']
    assert set(caller['needs']) == set(ci['jobs']) - {'deploy-dev'}, caller['needs']
    assert caller['uses'] == './.github/workflows/deploy-dev.yml', caller['uses']
    assert caller['secrets'] == 'inherit', caller['secrets']
    assert caller['if'] == "github.event_name == 'push' && github.ref == 'refs/heads/dev'", caller['if']
    steps = workflow['jobs']['deploy']['steps']
    deploy_step = next(step for step in steps if step.get('name') == 'Deploy and wait for Coolify')
    script = root / 'deploy.sh'
    script.write_text(deploy_step['run'])
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    curl_file = bin_dir / 'curl'
    curl_file.write_text(mock_curl)
    curl_file.chmod(0o755)
    for scenario, expected_code, expected_post, expected_message in [
        ('stale', 1, False, 'dev ya apunta'),
        ('no_read', 1, False, "permiso 'read'"),
        ('mismatch', 1, True, 'Coolify terminó con commit'),
        ('success', 0, True, 'Despliegue terminado'),
    ]:
        post_log = root / f'{scenario}.post'
        env = os.environ.copy()
        env.update({
            'PATH': f'{bin_dir}:{env["PATH"]}',
            'MOCK_SCENARIO': scenario,
            'MOCK_POST_LOG': str(post_log),
            'TARGET_SHA': target,
            'GH_TOKEN': 'test-token',
            'GITHUB_REPOSITORY': 'PabloArauzCaballero/AtlasBackend',
            'GITHUB_STEP_SUMMARY': str(root / f'{scenario}.summary'),
            'COOLIFY_DEPLOY_WEBHOOK': 'http://100.101.207.88:8000/api/v1/deploy?uuid=app-1&force=false',
            'COOLIFY_API_TOKEN': 'test-token',
            'COOLIFY_API': 'http://100.101.207.88:8000/api/v1',
        })
        result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
        assert result.returncode == expected_code, (scenario, result.stdout, result.stderr)
        assert post_log.exists() == expected_post, (scenario, result.stdout, result.stderr)
        assert expected_message in result.stdout, (scenario, result.stdout, result.stderr)
        print(f'{scenario}: exit={result.returncode}, POST={post_log.exists()}')
