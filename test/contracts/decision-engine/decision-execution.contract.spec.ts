/**
 * @file P-14 — conformidad de Core como consumidor de `POST /v1/decisions/{artifactCode}` del motor.
 * @business Ningún código de estado, cuerpo roto o caída del motor se convierte en un crédito
 *   concedido ni en un rechazo crediticio del cliente: sólo una aprobación limpia concede.
 * @system transporte, reintentos, plazo y parseo REALES de Core contra un motor doble HTTP que
 *   responde con las formas del motor (fixture con su commit de origen).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ResilientAdapterExecutorService } from '../../../src/common/resilience/resilient-adapter-executor.service.js';
import { CreditDecisionEngineService } from '../../../src/modules/decision-engine/credit-decision-engine.service.js';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';
import { classifyDecision } from '../../../src/modules/decision-engine/decision-verdict.js';
import { EngineTransportService } from '../../../src/modules/decision-engine/engine-transport.service.js';
import { noDecisionBasis, noDecisionEconomic, noDecisionVariables, succeeded } from './fixtures/engine-responses.js';
import { ENGINE_OPENAPI, EngineDouble, pointCoreAt, problem, requestSchema, validate } from './support/engine-contract.js';

const DECISION = '/v1/decisions/BNPL_CREDIT_DECISION';
const CONSENTS = '/v1/risk-governance/consents';

let engine: EngineDouble;
let restoreEnv: () => void;
let baseUrl: string;

beforeAll(async () => {
  engine = new EngineDouble();
  baseUrl = await engine.start();
});

afterAll(async () => {
  await engine.stop();
});

beforeEach(() => {
  engine.requests.length = 0;
  restoreEnv = pointCoreAt(baseUrl);
});

afterEach(() => {
  restoreEnv();
  jest.restoreAllMocks();
});

/** Un cliente con el transporte y el ejecutor resiliente REALES (circuito nuevo en cada prueba). */
function realClient(): DecisionEngineClient {
  return new DecisionEngineClient(new EngineTransportService(new ResilientAdapterExecutorService()));
}

const request = {
  requestId: 'credit-app-APP-5',
  idempotencyKey: 'credit-app-5:basis-1',
  subjectReference: 'subj-1',
  variables: { requested_amount: 80 },
};

describe('P-14 · el fixture del contrato es el del motor', () => {
  it('el fixture declara su commit de origen', () => {
    expect(ENGINE_OPENAPI['x-atlas-source'].commit).toMatch(/^[0-9a-f]{40}$/);
    expect(ENGINE_OPENAPI['x-atlas-source'].file).toBe('openapi/openapi.json');
  });

  it('el validador del contrato detecta un cuerpo que el motor rechazaría', () => {
    expect(validate(requestSchema('/v1/decisions/{artifactCode}'), { requestId: 'x', variables: {} })).toContain(
      '$.idempotencyKey: obligatorio',
    );
    expect(validate('RecordConsentDto', { subjectReference: 's', purpose: 'p', basis: 'MAYBE', grantedAt: 'x' })).toHaveLength(1);
  });
});

describe('P-14 · POST /v1/decisions: 200/201', () => {
  it('una aprobación limpia se lee entera y concede; el cuerpo enviado cumple ExecuteDecisionDto', async () => {
    engine.reply(DECISION, { status: 201, body: succeeded() });

    const response = await realClient().execute('BNPL_CREDIT_DECISION', {
      ...request,
      variableMetadata: { requested_amount: { observedAt: '2026-09-24T12:00:00.000Z' } },
    });

    expect(classifyDecision(response)).toEqual({ kind: 'approved', reason: 'APPROVE' });
    expect(response.decisionValidUntil).toBe('2026-09-24T13:00:00.000Z');
    expect(response.exposure?.remainingAfterDecision).toBe(20);
    const [call] = engine.callsTo(DECISION);
    expect(validate(requestSchema('/v1/decisions/{artifactCode}'), call.body)).toEqual([]);
    expect(call.body.variableMetadata).toEqual({ requested_amount: { observedAt: '2026-09-24T12:00:00.000Z' } });
    // La ejecución va con la llave de RUNTIME, nunca con la de gobierno.
    expect(call.headers['x-api-key']).toBe('llave-runtime');
  });

  it('un campo desconocido que el motor añada no rompe la lectura ni cambia el veredicto', async () => {
    engine.reply(DECISION, { status: 201, body: succeeded({ newAdditiveField: { anything: [1, 2] }, explanationUrl: 'x' }) });
    const response = await realClient().execute('BNPL_CREDIT_DECISION', request);
    expect(classifyDecision(response).kind).toBe('approved');
  });

  it('un campo conocido con otro tipo es un contrato roto: se rechaza en el borde', async () => {
    engine.reply(DECISION, { status: 201, body: succeeded({ decisionValidUntil: 12 }) });
    await expect(realClient().execute('BNPL_CREDIT_DECISION', request)).rejects.toThrow(/forma que el core no reconoce/);
  });

  it.each([
    [
      'frescura desconocida de una variable crítica',
      { freshnessUnknown: ['declared_monthly_income'] },
      'FRESHNESS_UNKNOWN:declared_monthly_income',
    ],
    ['entradas degradadas', { degradedInputs: true }, 'REVIEW_FLAG:degradedInputs'],
    [
      'exposición superada tras la decisión',
      { exposure: { ...(succeeded().exposure as object), remainingAfterDecision: -60 } },
      'EXPOSURE_LIMIT_EXCEEDED',
    ],
  ])('una aprobación con %s NO concede', async (_name, overrides, reason) => {
    engine.reply(DECISION, { status: 201, body: succeeded(overrides) });
    const response = await realClient().execute('BNPL_CREDIT_DECISION', request);
    expect(classifyDecision(response)).toMatchObject({ kind: 'review', reason });
  });
});

describe('P-14 · POST /v1/decisions: 422 NO_DECISION es revisión técnica', () => {
  it.each([
    ['VARIABLE_MISSING_OR_INVALID', noDecisionVariables],
    ['ENABLING_BASIS_MISSING', noDecisionBasis],
    ['ECONOMIC_OUTPUT_INVALID', noDecisionEconomic],
  ])('%s → revisión técnica, ni rechazo ni aprobación, y sin reintento', async (code, body) => {
    engine.reply(DECISION, { status: 422, body });
    const response = await realClient().execute('BNPL_CREDIT_DECISION', request);
    expect(classifyDecision(response)).toEqual({ kind: 'review', reason: `TECHNICAL_NO_DECISION:${code}`, technical: true });
    expect(engine.callsTo(DECISION)).toHaveLength(1);
  });
});

describe('P-14 · POST /v1/decisions: errores del motor', () => {
  it.each([
    [401, 'UNAUTHORIZED', 1],
    [403, 'ENABLING_BASIS_INVALID', 1],
    [403, 'SUBJECT_CONSENT_INVALID', 1],
    [409, 'IDEMPOTENCY_KEY_REUSED', 1],
    [429, 'RATE_LIMITED', 2],
    [500, 'INTERNAL_ERROR', 2],
    [503, 'SERVICE_UNAVAILABLE', 2],
  ])('HTTP %i (%s) lanza y se reintenta sólo si es transitorio (%i llamadas)', async (status, code, calls) => {
    engine.reply(DECISION, { status, body: problem(status, code) });
    await expect(realClient().execute('BNPL_CREDIT_DECISION', request)).rejects.toMatchObject({ httpStatus: status });
    expect(engine.callsTo(DECISION)).toHaveLength(calls);
    expect(validate('ProblemDetails', problem(status, code))).toEqual([]);
  });

  it('429 seguido de éxito: el reintento entrega la decisión', async () => {
    engine.reply(DECISION, { status: 429, body: problem(429, 'RATE_LIMITED') }, { status: 201, body: succeeded() });
    const response = await realClient().execute('BNPL_CREDIT_DECISION', request);
    expect(response.executionId).toBe('88001');
  });

  it('un motor que no contesta a tiempo es TIMEOUT, no una respuesta', async () => {
    engine.reply(DECISION, { status: 201, body: succeeded(), delayMs: 1_000 });
    await expect(realClient().execute('BNPL_CREDIT_DECISION', request)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('un cuerpo malformado (HTML de un proxy) no se toma por una decisión', async () => {
    engine.reply(DECISION, { status: 200, raw: '<html>502 Bad Gateway</html>' });
    await expect(realClient().execute('BNPL_CREDIT_DECISION', request)).rejects.toThrow(/forma que el core no reconoce/);
  });
});

describe('P-14 · CreditDecisionEngineService: base habilitante antes de decidir y nada concede por error', () => {
  function creditService(client: DecisionEngineClient) {
    const span = { setAttribute: () => undefined, addEvent: () => undefined };
    return new CreditDecisionEngineService(
      { runInSpan: (_n: string, _a: unknown, fn: (s: unknown) => unknown) => fn(span) } as never,
      client,
      { projectForCustomer: async () => ({ variables: {}, lineage: [], excluded: [] }) } as never,
      {
        build: async () => ({
          variables: { declared_monthly_income: 3000 },
          provenance: { declared_monthly_income: 'expediente' },
          variableMetadata: { declared_monthly_income: { observedAt: '2026-09-01T00:00:00.000Z' } },
          observedAt: { economy: new Date('2026-09-01T00:00:00.000Z'), identity: null },
        }),
      } as never,
      { register: async () => 'subj-1' } as never,
      { resolve: async () => ({ artifactCode: 'BNPL_CREDIT_DECISION' }) } as never,
    );
  }
  const application = {
    tenantId: '1',
    customerId: '24',
    applicationId: '5',
    applicationCode: 'APP-5',
    requestedAmount: '80.00',
    requestedTermMonths: 3,
    currencyCode: 'BOB',
    productCode: 'BNPL',
    purposeCode: null,
  };

  it('registra la base CREDIT_PROTECTION ANTES de decidir y decide con una clave ligada a esa base', async () => {
    engine.reply(CONSENTS, { status: 200, body: { id: '31' } }).reply(DECISION, { status: 201, body: succeeded() });

    const result = await creditService(realClient()).decide(application);

    expect(result.outcome.kind).toBe('approved');
    expect(engine.requests.map((call) => call.url)).toEqual([CONSENTS, DECISION]);
    const [grant] = engine.callsTo(CONSENTS);
    expect(validate(requestSchema(CONSENTS), grant.body)).toEqual([]);
    expect(grant.body).toMatchObject({ subjectReference: 'subj-1', purpose: 'credit_underwriting', basis: 'CREDIT_PROTECTION' });
    expect(grant.headers['x-api-key']).toBe('llave-gobierno');
    const [decision] = engine.callsTo(DECISION);
    expect(decision.body.idempotencyKey).toBe(`credit-app-5:basis-${new Date(String(grant.body.grantedAt)).getTime()}`);
    expect(decision.body.variableMetadata).toMatchObject({
      declared_monthly_income: { observedAt: '2026-09-01T00:00:00.000Z' },
    });
  });

  it('si la base no llega, NO se pregunta al motor: la solicitud queda diferida (reintentable)', async () => {
    engine.reply(CONSENTS, { status: 503, body: problem(503, 'SERVICE_UNAVAILABLE') }).reply(DECISION, { status: 201, body: succeeded() });

    const result = await creditService(realClient()).decide(application);

    expect(result.outcome).toEqual({ kind: 'deferred', reason: 'ENABLING_BASIS_NOT_REPLICATED' });
    expect(engine.callsTo(DECISION)).toHaveLength(0);
  });

  it('409 CONSENT_GRANT_REPLAYED: el motor ya tiene un estado más nuevo; se decide y el motor juzga', async () => {
    engine
      .reply(CONSENTS, { status: 409, body: problem(409, 'CONSENT_GRANT_REPLAYED') })
      .reply(DECISION, { status: 422, body: noDecisionBasis });

    const result = await creditService(realClient()).decide(application);

    expect(engine.callsTo(CONSENTS)).toHaveLength(1);
    expect(result.outcome).toMatchObject({ kind: 'review', technical: true, reason: 'TECHNICAL_NO_DECISION:ENABLING_BASIS_MISSING' });
  });

  it('compatibilidad: un motor ANTERIOR responde 404 SUBJECT_NOT_FOUND al alta y se decide como antes', async () => {
    engine.reply(CONSENTS, { status: 404, body: problem(404, 'SUBJECT_NOT_FOUND') }).reply(DECISION, { status: 201, body: succeeded() });
    const result = await creditService(realClient()).decide(application);
    expect(engine.callsTo(CONSENTS)).toHaveLength(1);
    expect(result.outcome.kind).toBe('approved');
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'ENABLING_BASIS_INVALID'],
    [500, 'INTERNAL_ERROR'],
  ])('HTTP %i en la decisión → motor no disponible (revisión humana), nunca rechazo', async (status, code) => {
    engine.reply(CONSENTS, { status: 200, body: { id: '31' } }).reply(DECISION, { status, body: problem(status, code) });
    const result = await creditService(realClient()).decide(application);
    expect(result.outcome.kind).toBe('engineUnavailable');
  });

  it('cuerpo malformado en la decisión → motor no disponible, nunca aprobación', async () => {
    engine.reply(CONSENTS, { status: 200, body: { id: '31' } }).reply(DECISION, { status: 200, raw: 'not json' });
    const result = await creditService(realClient()).decide(application);
    expect(result.outcome.kind).toBe('engineUnavailable');
  });
});
