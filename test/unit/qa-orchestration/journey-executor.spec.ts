import { JourneyExecutor } from '../../../src/modules/qa-orchestration/application/journey-executor';
import type {
  QaTransport,
  StepRecord,
  TransportRequest,
  TransportResponse,
} from '../../../src/modules/qa-orchestration/application/executor.ports';
import type { JourneyTemplate } from '../../../src/modules/qa-orchestration/domain/journey-recipe.types';
import { POST_LOGIN_FIRST_SCREEN } from '../../../src/modules/qa-orchestration/catalog/customer-account.recipes';

type Handler = (request: TransportRequest) => TransportResponse;

function fakeTransport(handler: Handler): QaTransport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    async send(request) {
      calls.push(request);
      return handler(request);
    },
  };
}

function executor(transport: QaTransport, sink: StepRecord[] = []) {
  return new JourneyExecutor({
    transport,
    admission: { admit: async () => ({ admissionLagMs: 0 }) },
    budget: { acquire: async () => ({ ok: true as const, release: () => undefined }) },
    credential: { headerFor: () => ({ 'x-atlas-qa-context': 'signed' }) },
    sink: { record: async (step) => void sink.push(step) },
    sleep: async () => undefined,
  });
}

function scope(personaKey: string) {
  return {
    persona: {
      personaKey,
      email: `${personaKey}@example.test`,
      phone: '70000000',
      firstName: 'Ana',
      lastName: 'Q',
      birthDate: '1990-01-01',
      pin: '7391',
      deviceFingerprintHash: 'f'.repeat(64),
    },
    fixtures: { signupConsents: [{ consentDocumentId: '1', purposeCode: 'terms', granted: true }] },
    run: { runId: 'run-1' },
    resources: {} as Record<string, unknown>,
    session: {} as Record<string, Record<string, unknown>>,
  };
}

const ok = (data: unknown, status = 200): TransportResponse => ({ status, body: { data }, latencyMs: 5 });

/** Backend falso con estado: cada alta crea un cliente y cada token identifica a SU cliente. */
function fakeBackend(options: { leakSessionOf?: string } = {}): Handler {
  let next = 100;
  const byEmail = new Map<string, string>();
  return (request) => {
    const token = request.headers.authorization?.slice(7);
    const bodyOf = request.body as { customer: { email: string }; identifier: string } | undefined;
    if (request.path === '/consent-documents/active') return ok([{ id: '1' }]);
    if (request.path === '/customer-onboarding/start') {
      const id = String(next++);
      byEmail.set(bodyOf!.customer.email, id);
      return ok({ customerId: id, lifecycleStatus: 'registered', tokens: { accessToken: `tok-${id}`, refreshToken: `ref-${id}` } }, 201);
    }
    if (request.path === '/auth/login') return ok({ accessToken: `tok-${byEmail.get(bodyOf!.identifier)}`, refreshToken: 'r' });
    if (request.path === '/auth/me') return ok({ customerId: options.leakSessionOf ?? token?.replace('tok-', '') });
    return ok({});
  };
}

const SIGNUP_ONLY: JourneyTemplate = { ...POST_LOGIN_FIRST_SCREEN, steps: POST_LOGIN_FIRST_SCREEN.steps.slice(0, 4) };

describe('ejecutor del recorrido de una persona', () => {
  it('dos personas simultáneas mantienen sesiones propias (A05)', async () => {
    const transport = fakeTransport(fakeBackend());
    const run = (key: string) =>
      executor(transport).run({
        tenantId: '1',
        runId: 'run-1',
        personaKey: key,
        template: SIGNUP_ONLY,
        scope: scope(key),
        signal: new AbortController().signal,
        defaultTimeoutMs: 1000,
      });
    const [a, b] = await Promise.all([run('p-0001'), run('p-0002')]);
    expect(a.map((step) => step.status)).toEqual(['PASSED', 'PASSED', 'PASSED', 'PASSED']);
    expect(b.map((step) => step.status)).toEqual(['PASSED', 'PASSED', 'PASSED', 'PASSED']);
    const meCalls = transport.calls.filter((call) => call.path === '/auth/me').map((call) => call.headers.authorization);
    expect(new Set(meCalls).size).toBe(2);
  });

  it('una sesión de otra persona hace fallar /auth/me aunque responda 200 (A02)', async () => {
    const steps = await executor(fakeTransport(fakeBackend({ leakSessionOf: '999' }))).run({
      tenantId: '1',
      runId: 'run-1',
      personaKey: 'p-0001',
      template: SIGNUP_ONLY,
      scope: scope('p-0001'),
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(steps[3].status).toBe('FAILED');
    expect(steps[3].failures[0].code).toBe('OWNERSHIP_MISMATCH');
  });

  it('un paso obligatorio que falla omite a los dependientes con su causa raíz y sin enviarlos (A07)', async () => {
    const transport = fakeTransport((request) =>
      request.path === '/customer-onboarding/start' ? { status: 500, body: {}, latencyMs: 1 } : fakeBackend()(request),
    );
    const steps = await executor(transport).run({
      tenantId: '1',
      runId: 'run-1',
      personaKey: 'p-0001',
      template: POST_LOGIN_FIRST_SCREEN,
      scope: scope('p-0001'),
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(steps[1].status).toBe('FAILED');
    const rest = steps.slice(2);
    expect(rest.every((step) => step.status === 'SKIPPED_DEPENDENCY' && step.rootCauseStepKey === 'signup.start')).toBe(true);
    expect(transport.calls.map((call) => call.path)).toEqual(['/consent-documents/active', '/customer-onboarding/start']);
  });

  it('una escritura sin respuesta es INDETERMINATE, no se reenvía y detiene a los dependientes', async () => {
    const transport = fakeTransport((request) =>
      request.path === '/auth/login' ? { status: null, error: 'TIMEOUT', latencyMs: 1000 } : fakeBackend()(request),
    );
    const steps = await executor(transport).run({
      tenantId: '1',
      runId: 'run-1',
      personaKey: 'p-0001',
      template: SIGNUP_ONLY,
      scope: scope('p-0001'),
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(steps[2].status).toBe('INDETERMINATE');
    expect(steps[3].status).toBe('SKIPPED_DEPENDENCY');
    expect(transport.calls.filter((call) => call.path === '/auth/login')).toHaveLength(1);
  });

  it('el alta lleva clave de idempotencia estable por operación y la evidencia no contiene tokens', async () => {
    const sink: StepRecord[] = [];
    const transport = fakeTransport(fakeBackend());
    await executor(transport, sink).run({
      tenantId: '1',
      runId: 'run-1',
      personaKey: 'p-0001',
      template: SIGNUP_ONLY,
      scope: scope('p-0001'),
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    const start = transport.calls.find((call) => call.path === '/customer-onboarding/start')!;
    expect(start.headers['x-idempotency-key']).toMatch(/^qa-[0-9a-f]{32}$/);
    expect(JSON.stringify(sink)).not.toContain('tok-');
    expect(sink[1].evidence.extracted).toEqual({ 'resources.customerId': '100' });
  });

  it('una corrida cancelada no envía más pasos', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = fakeTransport(fakeBackend());
    const steps = await executor(transport).run({
      tenantId: '1',
      runId: 'run-1',
      personaKey: 'p-0001',
      template: SIGNUP_ONLY,
      scope: scope('p-0001'),
      signal: controller.signal,
      defaultTimeoutMs: 1000,
    });
    expect(steps.every((step) => step.status === 'CANCELLED')).toBe(true);
    expect(transport.calls).toHaveLength(0);
  });

  it('un paso ya confirmado por un intento anterior del worker no se repite (A13)', async () => {
    const transport = fakeTransport(fakeBackend());
    const personaScope = scope('p-0001');
    personaScope.resources.customerId = '100';
    personaScope.session.customer = { accessToken: 'tok-100' };
    const done = (stepKey: string): [string, StepRecord] => [
      stepKey,
      {
        stepKey,
        visitIndex: 0,
        logicalOperationId: 'x',
        status: 'PASSED',
        failures: [],
        attempts: [],
        evidence: { method: 'POST', path: '/' },
        startedAt: '',
        finishedAt: '',
      },
    ];
    await executor(transport).run({
      tenantId: '1',
      runId: 'run-1',
      personaKey: 'p-0001',
      template: SIGNUP_ONLY,
      scope: personaScope,
      completed: new Map([done('signup.consent_documents'), done('signup.start'), done('signup.login')]),
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(transport.calls.map((call) => call.path)).toEqual(['/auth/me']);
  });
});

describe('cancelación con un paso en vuelo', () => {
  it('un 429 que llega tras cancelar es CANCELLED, no FAILED', async () => {
    const controller = new AbortController();
    const transport = fakeTransport((request) => {
      if (request.path === '/customer-onboarding/start') {
        controller.abort();
        return { status: 429, body: { error: { code: 'RATE_LIMIT_EXCEEDED' } }, latencyMs: 1 };
      }
      return fakeBackend()(request);
    });
    const steps = await executor(transport).run({
      tenantId: '1',
      runId: 'run-1',
      personaKey: 'p-0001',
      template: SIGNUP_ONLY,
      scope: scope('p-0001'),
      signal: controller.signal,
      defaultTimeoutMs: 1000,
    });
    expect(steps[1].status).toBe('CANCELLED');
    expect(steps.slice(2).every((step) => step.status === 'CANCELLED')).toBe(true);
  });
});
