import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types';
import { summary, tallySteps } from '../../../src/modules/qa-orchestration/application/qa-run-read.mappers';
import { QaRunReadService } from '../../../src/modules/qa-orchestration/application/qa-run-read.service';
import { QaWorkflowMatcher } from '../../../src/modules/qa-orchestration/application/qa-workflow-matcher';
import { ACCOUNT_SIGNUP_TO_LOGIN } from '../../../src/modules/qa-orchestration/catalog/customer-account.recipes';
import { CUSTOMER_CREDIT_JOURNEY } from '../../../src/modules/qa-orchestration/catalog/customer-credit.recipes';
import { JOURNEY_TEMPLATES } from '../../../src/modules/qa-orchestration/catalog/journey-catalog';
import type { JourneyTemplate } from '../../../src/modules/qa-orchestration/domain/journey-recipe.types';
import type { QaRunQueryRepository, RunRow } from '../../../src/modules/qa-orchestration/infrastructure/qa-run-query.repository';

const user: AuthenticatedUser = { sub: 's', tenantId: '7', internalUserId: '11', role: 'SUPER_ADMIN' as AuthenticatedUser['role'] };

const runRow = (overrides: Partial<RunRow> = {}): RunRow => ({
  _id: '42',
  _tenant_id: '7',
  operator_id: '11',
  status: 'COMPLETED',
  verdict: 'FAILED',
  template_code: 'account_signup_to_login',
  template_version: '1.0.0',
  workflow_code: 'customer_full_lifecycle',
  environment_id: 'qa-local',
  plan_hash: `${'h'.repeat(64)} `,
  recipe_hash: `${'r'.repeat(64)} `,
  plan_snapshot: { mode: 'INTEGRATED_QA', persons: 3, concurrency: 2, scenarioCode: 'happy_path', datasetMode: 'NORMAL_SYNTHETIC' },
  seed: 'semilla',
  namespace: 'qa-ns',
  reference_date: '2026-09-24',
  generator_version: 'persona-factory@1',
  counters_json: {},
  evidence_json: { mockNamespace: true, mockConfirmed: false, providerCalls: 0, detail: 'sin llamadas' },
  requests_issued: 12,
  error_message: null,
  cancel_requested_at: null,
  started_at: new Date('2026-09-24T10:00:00Z'),
  finished_at: new Date('2026-09-24T10:05:00Z'),
  _created_at: new Date('2026-09-24T09:59:00Z'),
  job_run_id: '7001',
  ...overrides,
});

function fakeQuery(row: RunRow | null = runRow()) {
  return {
    findRun: jest.fn(async () => row),
    listRuns: jest.fn(async () => (row ? [row] : [])),
    personaTally: jest.fn(async () => [
      { status: 'PASSED', count: '2' },
      { status: 'FAILED', count: '1' },
    ]),
    stepTally: jest.fn(async () => [
      { step_key: 'signup.start', workflow_step_code: 'lifecycle.signup', status: 'PASSED', count: '3' },
      { step_key: 'signup.me', workflow_step_code: 'lifecycle.auth_me', status: 'PASSED', count: '2' },
      { step_key: 'signup.me', workflow_step_code: 'lifecycle.auth_me', status: 'FAILED', count: '1' },
    ]),
    rootCauses: jest.fn(async () => [
      { step_key: 'signup.me', reason: 'la sesión es de otra persona', personas: '1' },
      { step_key: 'signup.login', reason: null, personas: '2' },
    ]),
    listPersonas: jest.fn(async () => ({
      items: [
        {
          ordinal: 1,
          persona_key: 'p-0001',
          status: 'FAILED',
          case_category: 'normal',
          archetype: 'asalariado',
          resources_json: null,
          failed_step_key: 'signup.me',
          reason: 'x',
          started_at: null,
          finished_at: null,
        },
      ],
      total: 3,
    })),
    listSteps: jest.fn(async () => [
      {
        step_key: 'signup.me',
        workflow_step_code: 'lifecycle.auth_me',
        status: 'FAILED',
        branch: null,
        reason: 'x',
        root_cause_step_key: null,
        failures_json: [],
        attempts_json: [],
        evidence_json: {},
        started_at: null,
        finished_at: null,
      },
    ]),
    events: jest.fn(async () => [
      { sequence: 4, event_type: 'RUN_STARTED', payload_json: {}, _created_at: new Date('2026-09-24T10:00:00Z') },
      {
        sequence: 5,
        event_type: 'PERSONA_FINISHED',
        payload_json: { personaKey: 'p-0001' },
        _created_at: new Date('2026-09-24T10:01:00Z'),
      },
    ]),
    workflowEndpoints: jest.fn(async (): Promise<Array<{ step_code: string; http_method: string; route_path: string }>> => []),
  };
}

function build(row: RunRow | null = runRow(), matched: (template: JourneyTemplate) => string[] = () => []) {
  const query = fakeQuery(row);
  const matcher = { matchedSteps: jest.fn(async (template: JourneyTemplate) => matched(template)) };
  const service = new QaRunReadService(query as unknown as QaRunQueryRepository, matcher as unknown as QaWorkflowMatcher);
  return { service, query, matcher };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpException) return (error.getResponse() as { code: string }).code;
    throw error;
  }
  throw new Error('se esperaba un rechazo');
}

describe('lecturas del laboratorio QA: catálogo', () => {
  it('sin flujo devuelve todas las plantillas y omite matchedStepCodes en vez de decir 0', async () => {
    const { service, matcher } = build();
    const { items } = await service.templates();
    expect(items).toHaveLength(JOURNEY_TEMPLATES.length);
    for (const item of items) expect(item).not.toHaveProperty('matchedStepCodes');
    expect(matcher.matchedSteps).not.toHaveBeenCalled();
  });

  it('con flujo filtra por endpoint y publica los pasos casados de cada plantilla', async () => {
    const { service } = build(runRow(), (template) => (template.code === 'account_signup_to_login' ? ['lifecycle.signup'] : []));
    const { items } = await service.templates('customer_partner_commerce');
    expect(items).toEqual([expect.objectContaining({ code: 'account_signup_to_login', matchedStepCodes: ['lifecycle.signup'] })]);
  });

  it('el detalle de plantilla lista pasos con endpoint normalizado y dependencia implícita del anterior', () => {
    const { service } = build();
    const detail = service.template('account_signup_to_login', '1.0.0');
    expect(detail.stepCount).toBe(ACCOUNT_SIGNUP_TO_LOGIN.steps.length);
    expect(detail.steps[0]).toMatchObject({
      stepKey: 'signup.consent_documents',
      dependsOn: [],
      endpoint: 'GET /consent-documents/active',
    });
    expect(detail.steps[1]).toMatchObject({ stepKey: 'signup.start', rateLimit: { bucket: 'onboarding_start', perMinute: 10 } });
    expect(detail.steps[2].dependsOn).toEqual(['signup.start']);
    expect(codeOf(() => service.template('no_existe', '1.0.0'))).toBe('QA_TEMPLATE_NOT_FOUND');
  });

  it('campañas y cobertura: un flujo desconocido es 404; el resumen cuadra con las filas', () => {
    const { service } = build();
    expect(service.campaigns().items.length).toBeGreaterThan(0);
    expect(codeOf(() => service.coverage('flujo_inexistente'))).toBe('QA_WORKFLOW_NOT_FOUND');
    const { rows, summary: resumen } = service.coverage('customer_full_lifecycle');
    expect(resumen.total).toBe(rows.length);
    expect(resumen.covered + resumen.gaps).toBe(resumen.total);
    expect(Object.values(resumen.byReason).reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(resumen.gaps);
    expect(service.coverage().summary.total).toBeGreaterThan(resumen.total);
  });

  it('los datos de muestra nunca enseñan el PIN ni la huella del dispositivo', () => {
    const { service } = build();
    const result = service.sampleInputs('account_signup_to_login', '1.0.0', { seed: 's', count: 2, datasetMode: 'NORMAL_SYNTHETIC' });
    expect(result.personas).toHaveLength(2);
    for (const persona of result.personas) {
      expect(persona).not.toHaveProperty('pin');
      expect(persona).not.toHaveProperty('deviceFingerprintHash');
      expect(persona).toHaveProperty('email');
    }
    expect(codeOf(() => service.sampleInputs('account_signup_to_login', '1.0.0', { seed: 's', count: 1, datasetMode: 'EDGE' }))).toBe(
      'QA_DATASET_MODE_UNSUPPORTED',
    );
    expect(codeOf(() => service.sampleInputs('x', '1', { seed: 's', count: 1, datasetMode: 'NORMAL_SYNTHETIC' }))).toBe(
      'QA_TEMPLATE_NOT_FOUND',
    );
  });
});

describe('lecturas del laboratorio QA: corridas', () => {
  it('una corrida de otro tenant recibe el mismo 404 que una inexistente', async () => {
    const { service } = build(null);
    await expect(service.run(user, '42')).rejects.toMatchObject({ response: { code: 'QA_RUN_NOT_FOUND' } });
    await expect(service.personas(user, '42', { page: 1, limit: 10 })).rejects.toBeInstanceOf(HttpException);
  });

  it('run() cuenta personas y pasos, con el endpoint de la receta en cada paso', async () => {
    const { service, query } = build();
    const detail = await service.run(user, '42');
    expect(query.findRun).toHaveBeenCalledWith('7', '42');
    expect(detail).toMatchObject({
      runId: '42',
      persons: 3,
      mode: 'INTEGRATED_QA',
      startedAt: '2026-09-24T10:00:00.000Z',
      cancelRequestedAt: null,
      counters: { personsRequested: 3, personsPassed: 2, personsFailed: 1, stepsPassed: 5, stepsFailed: 1, requestsIssued: 12 },
    });
    expect(detail.counters.passRate).toBeCloseTo(5 / 6);
    expect(detail.steps).toEqual([
      expect.objectContaining({ stepKey: 'signup.start', endpoint: 'POST /customer-onboarding/start', passed: 3, failed: 0 }),
      expect.objectContaining({ stepKey: 'signup.me', endpoint: 'GET /auth/me', passed: 2, failed: 1 }),
    ]);
    expect(detail.rootCauses).toEqual([
      { stepKey: 'signup.me', reason: 'la sesión es de otra persona', personas: 1 },
      { stepKey: 'signup.login', reason: 'sin detalle', personas: 2 },
    ]);
    expect(detail.evidence).toEqual({ mockNamespace: true, mockConfirmed: false, providerCalls: 0, detail: 'sin llamadas' });
  });

  it('una evidencia sin reconciliar se publica como desconocida, no como confirmada', async () => {
    const { service } = build(runRow({ evidence_json: {}, started_at: null, finished_at: null, cancel_requested_at: new Date(0) }));
    const detail = await service.run(user, '42');
    expect(detail.evidence).toEqual({
      mockNamespace: false,
      mockConfirmed: null,
      providerCalls: null,
      detail: 'La evidencia del mock se reconcilia al terminar la corrida.',
    });
    expect(detail).toMatchObject({ startedAt: null, finishedAt: null, cancelRequestedAt: '1970-01-01T00:00:00.000Z' });
  });

  it('lista corridas, personas, pasos y eventos con su forma pública', async () => {
    const { service, query } = build();
    expect((await service.runs(user, { limit: 10 })).items[0]).toMatchObject({ runId: '42', operatorId: '11', errorMessage: null });
    expect(query.listRuns).toHaveBeenCalledWith('7', { limit: 10 });

    const personas = await service.personas(user, '42', { page: 2, limit: 1 });
    expect(personas).toMatchObject({ total: 3, page: 2, limit: 1 });
    expect(personas.items[0]).toMatchObject({ personaKey: 'p-0001', resources: {}, failedStepKey: 'signup.me' });

    const steps = await service.steps(user, '42', 'p-0001');
    expect(steps.items[0]).toMatchObject({ stepKey: 'signup.me', workflowStepCode: 'lifecycle.auth_me', status: 'FAILED' });

    const events = await service.events(user, '42', 3);
    expect(events.nextCursor).toBe(5);
    expect(events.items[1]).toEqual({
      sequence: 5,
      type: 'PERSONA_FINISHED',
      payload: { personaKey: 'p-0001' },
      createdAt: '2026-09-24T10:01:00.000Z',
    });
    query.events.mockResolvedValueOnce([]);
    expect((await service.events(user, '42', 9)).nextCursor).toBe(9);
  });

  it('evidence() devuelve hashes recortados, el plan congelado y los conteos del detalle', async () => {
    const { service } = build();
    const evidence = await service.evidence(user, '42');
    expect(evidence).toMatchObject({
      runId: '42',
      planHash: 'h'.repeat(64),
      recipeHash: 'r'.repeat(64),
      namespace: 'qa-ns',
      referenceDate: '2026-09-24',
      verdict: 'FAILED',
      counters: { personsFailed: 1 },
    });
  });
});

describe('mappers de lectura', () => {
  it('summary junta proveedores ordenados y pasos del flujo cubiertos, sin repetidos', () => {
    const resumen = summary(CUSTOMER_CREDIT_JOURNEY);
    expect(resumen.providers).toEqual(['SEGIP']);
    expect(new Set(resumen.coveredStepCodes).size).toBe(resumen.coveredStepCodes.length);
    expect(summary(ACCOUNT_SIGNUP_TO_LOGIN)).toMatchObject({ providers: [], blockedReasons: [], stepCount: 4 });
  });

  it('tallySteps: sin plantilla el endpoint es null y un PENDING suma al total pero a ningún cubo', () => {
    const { steps, byStep } = tallySteps(
      [
        { step_key: 'a', workflow_step_code: null, status: 'PENDING', count: '2' },
        { step_key: 'a', workflow_step_code: null, status: 'SKIPPED_DEPENDENCY', count: '1' },
        { step_key: 'a', workflow_step_code: null, status: 'NOT_APPLICABLE', count: '1' },
        { step_key: 'a', workflow_step_code: null, status: 'INDETERMINATE', count: '1' },
        { step_key: 'a', workflow_step_code: null, status: 'CANCELLED', count: '1' },
      ],
      undefined,
    );
    expect(steps.PENDING).toBe(2);
    expect(byStep.get('a')).toEqual({
      stepKey: 'a',
      workflowStepCode: null,
      endpoint: null,
      passed: 0,
      failed: 0,
      skipped: 1,
      notApplicable: 1,
      indeterminate: 1,
      cancelled: 1,
    });
  });
});

describe('casamiento de plantillas con flujos por endpoint', () => {
  it('usa los pasos de la base cuando existen y los cachea', async () => {
    const query = fakeQuery();
    query.workflowEndpoints.mockResolvedValue([{ step_code: 'otro.me', http_method: 'get', route_path: '/auth/me/' }]);
    const matcher = new QaWorkflowMatcher(query as unknown as QaRunQueryRepository);
    expect(await matcher.matchedSteps(ACCOUNT_SIGNUP_TO_LOGIN, 'flujo_en_base')).toEqual(['otro.me']);
    expect(await matcher.stepsOf('flujo_en_base')).toEqual([{ stepCode: 'otro.me', endpoint: 'GET /auth/me' }]);
    expect(query.workflowEndpoints).toHaveBeenCalledTimes(1);
  });

  it('sin filas (o si la base falla) cae a los flujos declarados en el repositorio', async () => {
    const query = fakeQuery();
    query.workflowEndpoints.mockRejectedValueOnce(new Error('sin base'));
    const matcher = new QaWorkflowMatcher(query as unknown as QaRunQueryRepository);
    const matched = await matcher.matchedSteps(ACCOUNT_SIGNUP_TO_LOGIN, 'customer_full_lifecycle');
    expect(matched).toEqual(
      expect.arrayContaining(['lifecycle.consent_documents', 'lifecycle.signup', 'lifecycle.login', 'lifecycle.auth_me']),
    );
    expect(await matcher.stepsOf('flujo_desconocido')).toEqual([]);
  });
});
