import {
  deploymentEnvironment,
  qaExecutionAllowed,
  signQaCredential,
  verifyQaCredential,
} from '../../../src/platform/security/qa-execution-context';
import { runContextHeaders } from '../../../src/modules/external-data/domain/qa-run-context';
import { runtimeJobsEnvShape } from '../../../src/config/env.runtime-jobs.schema';

const SECRET = 's'.repeat(48);
const claims = { tenantId: '1', runId: '42', personaKey: 'p-0001', logicalOperationId: 'op-1', attempt: 1, environment: 'TEST' as const };

describe('identidad del entorno (H17)', () => {
  it('TEST con imagen productiva sigue siendo TEST si el despliegue lo declara', () => {
    expect(deploymentEnvironment({ NODE_ENV: 'production', ATLAS_DEPLOYMENT_ENVIRONMENT: 'TEST' })).toBe('TEST');
  });

  it('sin declarar, NODE_ENV=production se lee como PROD (lo más restrictivo)', () => {
    expect(deploymentEnvironment({ NODE_ENV: 'production' })).toBe('PROD');
    expect(deploymentEnvironment({ NODE_ENV: 'development' })).toBe('LOCAL');
  });

  it('PROD nunca admite QA aunque se encienda la bandera (A30)', () => {
    expect(qaExecutionAllowed({ ATLAS_DEPLOYMENT_ENVIRONMENT: 'PROD', QA_EXECUTION_ENABLED: 'true' })).toBe(false);
    expect(qaExecutionAllowed({ ATLAS_DEPLOYMENT_ENVIRONMENT: 'TEST', QA_EXECUTION_ENABLED: 'true' })).toBe(true);
    expect(qaExecutionAllowed({ ATLAS_DEPLOYMENT_ENVIRONMENT: 'TEST', QA_EXECUTION_ENABLED: 'false' })).toBe(false);
  });
});

describe('credencial QA firmada (A19)', () => {
  it('se verifica con el mismo secreto y entorno', () => {
    const verdict = verifyQaCredential(signQaCredential(claims, SECRET), SECRET, 'TEST');
    expect(verdict).toEqual({ ok: true, claims });
  });

  it('una firma falsificada o de otro secreto no activa nada', () => {
    const token = signQaCredential(claims, SECRET);
    expect(verifyQaCredential(token, 'x'.repeat(48), 'TEST')).toEqual({ ok: false, code: 'BAD_SIGNATURE' });
    const [version, payload] = token.split('.');
    expect(verifyQaCredential(`${version}.${payload}.AAAA`, SECRET, 'TEST').ok).toBe(false);
    expect(verifyQaCredential('x-mock-run-id: cualquiera', SECRET, 'TEST')).toEqual({ ok: false, code: 'MALFORMED' });
  });

  it('una credencial de TEST no vale en otro entorno ni en PROD', () => {
    const token = signQaCredential(claims, SECRET);
    expect(verifyQaCredential(token, SECRET, 'STAGING')).toEqual({ ok: false, code: 'WRONG_ENVIRONMENT' });
    expect(verifyQaCredential(signQaCredential({ ...claims, environment: 'PROD' }, SECRET), SECRET, 'PROD')).toEqual({
      ok: false,
      code: 'WRONG_ENVIRONMENT',
    });
  });

  it('caduca', () => {
    const token = signQaCredential(claims, SECRET, Date.now() - 10 * 60_000);
    expect(verifyQaCredential(token, SECRET, 'TEST')).toEqual({ ok: false, code: 'EXPIRED' });
  });
});

describe('propagación al mock (H09/H10)', () => {
  const context = { tenantId: '1', runId: 'qa-ns', runToken: 'tok', personaKey: 'p-0001', logicalOperationId: 'op-1', attempt: 2 };

  it('en mock_server fuera de PROD viajan run, persona, operación e intento; nunca Authorization', () => {
    const headers = runContextHeaders(context, { mode: 'mock_server', productionRuntime: false });
    expect(headers).toMatchObject({
      'x-mock-run-id': 'qa-ns',
      'x-mock-persona-key': 'p-0001',
      'x-mock-logical-operation-id': 'op-1',
      'x-mock-attempt': '2',
    });
    expect(Object.keys(headers)).not.toContain('authorization');
  });

  it('en PROD o en mock_local no viaja nada', () => {
    expect(runContextHeaders(context, { mode: 'mock_server', productionRuntime: true })).toEqual({});
    expect(runContextHeaders(context, { mode: 'mock_local', productionRuntime: false })).toEqual({});
  });
});

describe('banderas de consumidores', () => {
  it('RUNTIME_JOBS_STRESS_CONSUMER_ENABLED="false" queda APAGADO (antes z.coerce lo encendía)', () => {
    expect(runtimeJobsEnvShape.RUNTIME_JOBS_STRESS_CONSUMER_ENABLED.parse('false')).toBe(false);
    expect(runtimeJobsEnvShape.RUNTIME_JOBS_STRESS_CONSUMER_ENABLED.parse('true')).toBe(true);
    expect(runtimeJobsEnvShape.RUNTIME_JOBS_QA_CONSUMER_ENABLED.parse('false')).toBe(false);
    expect(runtimeJobsEnvShape.RUNTIME_JOBS_QA_CONSUMER_ENABLED.parse(undefined)).toBe(false);
  });
});
