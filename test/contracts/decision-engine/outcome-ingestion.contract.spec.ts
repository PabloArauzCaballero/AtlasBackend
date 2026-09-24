/**
 * @file P-14 — conformidad de Core con `POST /v1/outcomes/facilities` y `POST /v1/outcomes/batch`.
 * @business Un reenvío duplicado es un éxito; un conflicto es terminal y se alerta; un fallo por fila
 *   se reintenta sólo en esa fila; y una respuesta ilegible nunca da nada por entregado.
 * @system alta de créditos y despacho de desenlaces REALES, transporte real y motor doble HTTP que
 *   contesta con `FacilityRegistrationResultDto`/`OutcomeBatchResultDto` (validados contra el fixture).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ResilientAdapterExecutorService } from '../../../src/common/resilience/resilient-adapter-executor.service.js';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';
import { EngineTransportService } from '../../../src/modules/decision-engine/engine-transport.service.js';
import { FacilityRegistrationService } from '../../../src/modules/decision-engine/facility-registration.service.js';
import { OutcomeDispatchService } from '../../../src/modules/decision-engine/outcome-dispatch.service.js';
import { EngineDouble, pointCoreAt, problem, requestSchema, validate } from './support/engine-contract.js';

const FACILITIES = '/v1/outcomes/facilities';
const BATCH = '/v1/outcomes/batch';

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

function realClient() {
  return new DecisionEngineClient(new EngineTransportService(new ResilientAdapterExecutorService()));
}

function loan(code: string, executionId: string) {
  return {
    id: code,
    loanCode: code,
    decisionExecutionId: executionId,
    principalAmount: '1500.00',
    currencyCode: 'BOB',
    termMonths: 12,
    annualInterestRate: '0.2800',
    disbursedAt: new Date('2026-09-01T00:00:00.000Z'),
    decisionFacilityRegisteredAt: null as Date | null,
    decisionFacilityRejectedAt: null as Date | null,
    decisionFacilityRejectionCode: null as string | null,
    save: jest.fn(async () => undefined),
  };
}

describe('P-14 · POST /v1/outcomes/facilities', () => {
  const loans = () => [loan('L-NEW', '1'), loan('L-DUP', '2'), loan('L-CONFLICT', '3'), loan('L-NOTDECIDED', '4'), loan('L-FAILED', '5')];
  const body = {
    registered: 2,
    rejected: 3,
    duplicates: 1,
    rows: [
      { externalReference: 'L-NEW', accepted: true },
      { externalReference: 'L-DUP', accepted: true, duplicate: true },
      { externalReference: 'L-CONFLICT', accepted: false, code: 'FACILITY_REFERENCE_CONFLICT', message: 'otra decisión' },
      { externalReference: 'L-NOTDECIDED', accepted: false, code: 'EXECUTION_NOT_DECIDED', message: 'NO_DECISION' },
      { externalReference: 'L-FAILED', accepted: false, code: 'FACILITY_REGISTRATION_FAILED', message: 'escritura' },
    ],
  };

  it('la respuesta del doble cumple el contrato del motor', () => {
    expect(validate('FacilityRegistrationResultDto', body)).toEqual([]);
  });

  it('duplicado = registrado; conflicto y decisión no terminada = terminales; fallo de escritura = reintento', async () => {
    engine.reply(FACILITIES, { status: 200, body });
    const pending = loans();
    const service = new FacilityRegistrationService(realClient(), { findAll: async () => pending } as never);

    const result = await service.registrarCreditosNuevos({ tenantId: '1', limit: 50 });

    const [call] = engine.callsTo(FACILITIES);
    expect(validate(requestSchema(FACILITIES), call.body)).toEqual([]);
    expect(call.headers['x-api-key']).toBe('llave-desenlaces');
    expect(result).toEqual({ registrados: 2, rechazados: 3, terminales: 2 });
    const byCode = Object.fromEntries(pending.map((row) => [row.loanCode, row]));
    expect(byCode['L-NEW'].decisionFacilityRegisteredAt).toBeInstanceOf(Date);
    expect(byCode['L-DUP'].decisionFacilityRegisteredAt).toBeInstanceOf(Date);
    expect(byCode['L-CONFLICT']).toMatchObject({
      decisionFacilityRegisteredAt: null,
      decisionFacilityRejectionCode: 'FACILITY_REFERENCE_CONFLICT',
    });
    expect(byCode['L-NOTDECIDED']).toMatchObject({
      decisionFacilityRegisteredAt: null,
      decisionFacilityRejectionCode: 'EXECUTION_NOT_DECIDED',
    });
    // Fallo transitorio de UNA fila: ni registrado ni terminal, vuelve en la pasada siguiente.
    expect(byCode['L-FAILED']).toMatchObject({ decisionFacilityRegisteredAt: null, decisionFacilityRejectedAt: null });
  });

  it.each([
    [401, 1],
    [429, 2],
    [503, 2],
  ])('HTTP %i en el lote: no se marca nada (%i llamadas)', async (status, calls) => {
    engine.reply(FACILITIES, { status, body: problem(status, `E${status}`) });
    const pending = loans();
    const service = new FacilityRegistrationService(realClient(), { findAll: async () => pending } as never);
    const result = await service.registrarCreditosNuevos({ tenantId: '1', limit: 50 });
    expect(result.registrados).toBe(0);
    expect(engine.callsTo(FACILITIES)).toHaveLength(calls);
    expect(pending.every((row) => row.decisionFacilityRegisteredAt === null && row.decisionFacilityRejectedAt === null)).toBe(true);
  });

  it('un cuerpo ilegible no registra ningún crédito', async () => {
    engine.reply(FACILITIES, { status: 200, raw: '<html>oops</html>' });
    const pending = loans();
    const service = new FacilityRegistrationService(realClient(), { findAll: async () => pending } as never);
    const result = await service.registrarCreditosNuevos({ tenantId: '1', limit: 50 });
    expect(result.registrados).toBe(0);
    expect(pending.every((row) => row.decisionFacilityRegisteredAt === null)).toBe(true);
  });
});

describe('P-14 · POST /v1/outcomes/batch', () => {
  function report(id: string, loanId: string) {
    return {
      id,
      loanId,
      decisionExecutionId: '1',
      windowDays: 90,
      label: 'GOOD',
      amount: null,
      source: 'ATLAS_CORE',
      notes: null,
      status: 'pending',
      attempts: 0,
      lastError: null as string | null,
      sentAt: null as Date | null,
      updatedAtValue: null as Date | null,
      observedAt: new Date('2026-09-01T00:00:00.000Z'),
      save: jest.fn(async () => undefined),
    };
  }
  const reports = () => [report('r1', 'L1'), report('r2', 'L2'), report('r3', 'L3'), report('r4', 'L4')];
  const loans = [
    { id: 'L1', loanCode: 'LOAN-1' },
    { id: 'L2', loanCode: 'LOAN-2' },
    { id: 'L3', loanCode: 'LOAN-3' },
    { id: 'L4', loanCode: 'LOAN-4' },
  ];

  function dispatcher(pending: ReturnType<typeof reports>) {
    return new OutcomeDispatchService(
      realClient(),
      { findAll: async () => pending } as never,
      { findAll: async () => loans } as never,
      {} as never,
    );
  }

  const body = {
    accepted: 2,
    rejected: 2,
    duplicates: 1,
    dryRun: false,
    rows: [
      { externalReference: 'LOAN-1', windowDays: 90, accepted: true },
      { externalReference: 'LOAN-2', windowDays: 90, accepted: true, duplicate: true },
      { externalReference: 'LOAN-3', windowDays: 90, accepted: false, code: 'OUTCOME_CONFLICT', message: 'otro desenlace' },
      { externalReference: 'LOAN-4', windowDays: 90, accepted: false, code: 'FACILITY_NOT_FOUND', message: 'sin alta' },
    ],
  };

  it('la respuesta del doble cumple el contrato del motor', () => {
    expect(validate('OutcomeBatchResultDto', body)).toEqual([]);
  });

  it('duplicado = enviado; OUTCOME_CONFLICT = terminal con alerta; FACILITY_NOT_FOUND = reintento', async () => {
    engine.reply(BATCH, { status: 200, body });
    const pending = reports();
    const service = dispatcher(pending);
    const errors = jest
      .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    const result = await service.dispatchPending({ tenantId: '1', limit: 50 });

    const [call] = engine.callsTo(BATCH);
    expect(validate(requestSchema(BATCH), call.body)).toEqual([]);
    expect(result).toEqual({ sent: 2, failed: 2, skipped: 0, conflicts: 1 });
    expect(pending[0]).toMatchObject({ status: 'sent', lastError: null });
    expect(pending[1]).toMatchObject({ status: 'sent', lastError: null });
    expect(pending[2]).toMatchObject({ status: 'failed', attempts: 6 });
    expect(pending[2].lastError).toContain('OUTCOME_CONFLICT');
    expect(pending[3]).toMatchObject({ status: 'failed', attempts: 1, lastError: 'FACILITY_NOT_FOUND' });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('OUTCOME_CONFLICT'));
  });

  it('una fila sin veredicto en la respuesta NO se da por enviada', async () => {
    engine.reply(BATCH, { status: 200, body: { ...body, rows: body.rows.slice(0, 1) } });
    const pending = reports();
    const result = await dispatcher(pending).dispatchPending({ tenantId: '1', limit: 50 });
    expect(result.sent).toBe(1);
    expect(pending.slice(1).every((row) => row.status === 'failed' && row.lastError === 'NO_ROW_VERDICT')).toBe(true);
  });

  it.each([
    [401, 1],
    [429, 2],
    [500, 2],
  ])('HTTP %i en el lote: todas quedan para reintento (%i llamadas)', async (status, calls) => {
    engine.reply(BATCH, { status, body: problem(status, `E${status}`) });
    const pending = reports();
    const result = await dispatcher(pending).dispatchPending({ tenantId: '1', limit: 50 });
    expect(result.sent).toBe(0);
    expect(engine.callsTo(BATCH)).toHaveLength(calls);
    expect(pending.every((row) => row.status === 'failed' && row.attempts === 1)).toBe(true);
  });

  it('timeout del motor: nada se da por enviado', async () => {
    engine.reply(BATCH, { status: 200, body, delayMs: 1_000 });
    const pending = reports();
    const result = await dispatcher(pending).dispatchPending({ tenantId: '1', limit: 50 });
    expect(result.sent).toBe(0);
  });
});
