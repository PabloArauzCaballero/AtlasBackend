/**
 * @file P-14 · B20 — eventos Core ↔ ERP contra PostgreSQL real: una sola vez, en orden, sin perder nada.
 * @business Diez entregas de la misma cobertura liquidada dejan UNA proyección; una versión vieja no
 *   revierte la nueva; el aviso de pago confirmado y su entrega al ERP nacen juntos o no nacen; la
 *   entrega al ERP respeta el orden por cuota, reintenta lo transitorio y deja visible lo agotado.
 * @system Servicios reales (`ErpEventInboxService`, `enqueueOutboundDeliveries` vía `EventsRepository`,
 *   `ErpEventDeliveryService`) sobre la base de integración. Sólo se dobla la red con un `fetch` de
 *   prueba; la firma, la unicidad, los leases y el orden son los de producción.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { ErpEventDeliveryService, type DeliveryPolicy } from '../../../src/modules/erp-integration/erp-event-delivery.service.js';
import { ErpEventInboxService } from '../../../src/modules/erp-integration/erp-event-inbox.service.js';
import { InstallmentCoverageProjection } from '../../../src/modules/erp-integration/installment-coverage.projection.js';
import type { IntegrationEnvelope } from '../../../src/modules/erp-integration/integration-envelope.schemas.js';
import { SignedEventPublisher } from '../../../src/modules/erp-integration/signed-event-publisher.js';
import { SIGNATURE_HEADER, verifyEventSignature } from '../../../src/platform/security/signed-event.js';
import { loadSchemaRegistry, validateEnvelope, type TopicEntry } from '../../contracts/atlas-integration/json-schema-subset.js';
import { buildLoanBookHarness, customerUser, merchantOf, type LoanBookHarness } from '../credit/support/loan-book-harness.js';
import { openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let harness: LoanBookHarness | null = null;

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) harness = await buildLoanBookHarness(database.sequelize);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (database) {
    await database.sequelize.query(`DELETE FROM platform_ops.external_event_inbox WHERE event_key LIKE 'it-p14-%'`);
    await database.sequelize.query(`DELETE FROM platform_ops.external_aggregate_versions WHERE aggregate_id LIKE 'it-p14-%'`);
    await database.sequelize.query(
      `DELETE FROM credit.installment_coverage_projections WHERE settlement_reference LIKE 'IT-P14-%' OR _tenant_id IS NULL`,
    );
  }
  await harness?.cleanup();
  await database?.close();
});

const CONTRACT = resolve(__dirname, '../../../contracts/atlas-integration-v1');
const registry = loadSchemaRegistry(CONTRACT);
const topics = (JSON.parse(readFileSync(join(CONTRACT, 'topics.json'), 'utf8')) as { topics: TopicEntry[] }).topics;
const PARTNER = '910071';
const SECRET = 'it-p14-secreto-de-entrega-de-32-caracteres-o-mas';
const POLICY: DeliveryPolicy = { leaseMs: 60_000, maxAttempts: 3, retryBaseMs: 1, retryMaxMs: 1 };

type Loan = Awaited<ReturnType<LoanBookHarness['createLoan']>>;

function coreRefOf(h: LoanBookHarness, loan: Loan, index = 0) {
  return { tenantId: h.tenantId, loanId: loan.loanId, installmentId: String(loan.installments[index]!.id), partnerProfileId: PARTNER };
}

function settledEnvelope(
  coreRef: Record<string, string> | null,
  overrides: { payableId?: string; version?: number } = {},
): IntegrationEnvelope {
  const payableId = overrides.payableId ?? randomUUID();
  return {
    spec: 'atlas.erp.outbox/1',
    eventKey: `it-p14-coverage-settled-${payableId}`,
    topic: 'b2b.coverage.settled',
    schemaVersion: 1,
    aggregate: { type: 'merchant_payable', id: `it-p14-${payableId}`, version: overrides.version ?? 2 },
    occurredAt: '2026-09-24T12:00:00.000Z',
    producer: 'atlas-erp',
    payload: {
      payableId,
      installmentId: randomUUID(),
      purchaseId: randomUUID(),
      merchantAccountId: randomUUID(),
      consumerId: randomUUID(),
      settlementId: randomUUID(),
      settlementReference: `IT-P14-${payableId.slice(0, 8)}`,
      amount: '333.33',
      currency: 'BOB',
      paidAt: '2026-09-24T12:00:00.000Z',
      recoveryId: randomUUID(),
      coreRef,
    },
  };
}

function movementEnvelope(recoveryId: string, version: number, amountRecovered: string, status: string): IntegrationEnvelope {
  const movementId = randomUUID();
  return {
    spec: 'atlas.erp.outbox/1',
    eventKey: `it-p14-recovery-movement-${movementId}`,
    topic: 'b2b.recovery.payment_applied',
    schemaVersion: 1,
    aggregate: { type: 'consumer_recovery', id: `it-p14-${recoveryId}`, version },
    occurredAt: '2026-09-24T12:00:00.000Z',
    producer: 'atlas-erp',
    payload: {
      recoveryId,
      installmentId: randomUUID(),
      consumerId: randomUUID(),
      movementId,
      movementType: 'PAYMENT',
      paymentReference: `IT-P14-REC-${movementId.slice(0, 8)}`,
      amount: '100.00',
      currency: 'BOB',
      amountRecovered,
      recoveryStatus: status,
      coreRef: null,
    },
  };
}

async function count(h: LoanBookHarness, sql: string, bind: Record<string, unknown>): Promise<number> {
  const rows = await h.sequelize.query<{ n: string }>(sql, { type: QueryTypes.SELECT, bind });
  return Number(rows[0]?.n ?? 0);
}

describe('P-14 · receptor de eventos del ERP (inbox de Core)', () => {
  it('diez entregas de la misma cobertura liquidada dejan UNA proyección y un recibo', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    const inbox = new ErpEventInboxService(h.sequelize);
    const envelope = settledEnvelope(coreRefOf(h, loan));

    const sequential = [];
    for (let i = 0; i < 5; i += 1) sequential.push((await inbox.receive(envelope)).outcome);
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => inbox.receive(envelope).then((r) => r.outcome)));

    expect([...sequential, ...concurrent].filter((outcome) => outcome === 'APPLIED')).toHaveLength(1);
    expect([...sequential, ...concurrent].filter((outcome) => outcome === 'DUPLICATE')).toHaveLength(9);
    expect(
      await count(h, `SELECT count(*) AS n FROM platform_ops.external_event_inbox WHERE event_key = $k`, { k: envelope.eventKey }),
    ).toBe(1);
    const projection = await new InstallmentCoverageProjection(h.sequelize).forLoan({ tenantId: h.tenantId, loanId: loan.loanId });
    expect(projection).toHaveLength(1);
    expect(projection[0]).toMatchObject({
      installment_id: String(loan.installments[0]!.id),
      amount_covered: '333.33',
      amount_recovered: '0.00',
      recovery_status: 'OPEN',
    });
  });

  it('Core no cambia la cuota ni su saldo al recibir la cobertura: sólo proyecta el hecho', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    const before = await h.query(`SELECT status, paid_principal FROM credit.loan_installments WHERE _id = $id`, {
      id: loan.installments[0]!.id,
    });
    await new ErpEventInboxService(h.sequelize).receive(settledEnvelope(coreRefOf(h, loan)));
    const after = await h.query(`SELECT status, paid_principal FROM credit.loan_installments WHERE _id = $id`, {
      id: loan.installments[0]!.id,
    });
    expect(after).toEqual(before);
  });

  it('una versión vieja del agregado llega tarde y NO revierte la recuperación (STALE)', async () => {
    if (!harness) return;
    const inbox = new ErpEventInboxService(harness.sequelize);
    const recoveryId = randomUUID();
    const v2 = movementEnvelope(recoveryId, 2, '100.00', 'PARTIALLY_RECOVERED');
    const v3 = { ...movementEnvelope(recoveryId, 3, '333.33', 'RECOVERED'), aggregate: { ...v2.aggregate, version: 3 } };

    expect((await inbox.receive(v3)).outcome).toBe('UNLINKED');
    expect((await inbox.receive({ ...v2, aggregate: { ...v2.aggregate } })).outcome).toBe('STALE');

    const rows = await harness.sequelize.query<{ amount_recovered: string; recovery_status: string }>(
      `SELECT amount_recovered::text AS amount_recovered, recovery_status FROM credit.installment_coverage_projections WHERE erp_recovery_id = $id`,
      { type: QueryTypes.SELECT, bind: { id: recoveryId } },
    );
    expect(rows).toEqual([{ amount_recovered: '333.33', recovery_status: 'RECOVERED' }]);
  });

  it('una cobertura cuya cuota no existe en Core, o sin mapeo, queda UNLINKED y sin atribuirse a otra cuota', async () => {
    if (!harness) return;
    const inbox = new ErpEventInboxService(harness.sequelize);
    const ghost = settledEnvelope({ tenantId: harness.tenantId, loanId: '999999999', installmentId: '999999998' });
    const unmapped = settledEnvelope(null);
    expect((await inbox.receive(ghost)).outcome).toBe('UNLINKED');
    expect((await inbox.receive(unmapped)).outcome).toBe('UNLINKED');
    const rows = await harness.sequelize.query<{ loan_id: string | null }>(
      `SELECT loan_id::text AS loan_id FROM credit.installment_coverage_projections WHERE settlement_reference IN ($a, $b)`,
      { type: QueryTypes.SELECT, bind: { a: ghost.payload.settlementReference, b: unmapped.payload.settlementReference } },
    );
    expect(rows).toEqual([{ loan_id: null }, { loan_id: null }]);
  });

  it('un tópico que Core no usa (accounting.*) se acusa sin efecto y queda IGNORED', async () => {
    if (!harness) return;
    const key = `it-p14-accounting-${randomUUID()}`;
    const outcome = await new ErpEventInboxService(harness.sequelize).receive({
      spec: 'atlas.erp.outbox/1',
      eventKey: key,
      topic: 'accounting.document.posted',
      schemaVersion: 1,
      aggregate: { type: 'accounting_document', id: `it-p14-${key}`, version: 1 },
      occurredAt: '2026-09-24T12:00:00.000Z',
      producer: 'atlas-erp',
      payload: { accountingDocumentId: randomUUID() },
    });
    expect(outcome.outcome).toBe('IGNORED');
    const rows = await harness.query<{ outcome: string }>(`SELECT outcome FROM platform_ops.external_event_inbox WHERE event_key = $k`, {
      k: key,
    });
    expect(rows).toEqual([{ outcome: 'IGNORED' }]);
  });

  it('un payload fuera de contrato es 422 y no deja recibo (el ERP lo manda a DEAD)', async () => {
    if (!harness) return;
    const bad = settledEnvelope(null);
    const envelope = { ...bad, payload: { ...bad.payload, amount: 333.33 } };
    await expect(new ErpEventInboxService(harness.sequelize).receive(envelope)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(
      await count(harness, `SELECT count(*) AS n FROM platform_ops.external_event_inbox WHERE event_key = $k`, { k: bad.eventKey }),
    ).toBe(0);
  });

  it('si el efecto falla se revierte también el recibo y el reintento lo aplica una vez', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    const inbox = new ErpEventInboxService(h.sequelize);
    const envelope = settledEnvelope(coreRefOf(h, loan));
    const spy = jest
      .spyOn(InstallmentCoverageProjection.prototype, 'applySettlement')
      .mockRejectedValueOnce(new Error('caída a mitad del efecto'));

    await expect(inbox.receive(envelope)).rejects.toThrow('caída a mitad del efecto');
    expect(
      await count(h, `SELECT count(*) AS n FROM platform_ops.external_event_inbox WHERE event_key = $k`, { k: envelope.eventKey }),
    ).toBe(0);
    spy.mockRestore();

    expect((await inbox.receive(envelope)).outcome).toBe('APPLIED');
    expect((await inbox.receive(envelope)).outcome).toBe('DUPLICATE');
  });
});

describe('P-14 · entrega de payment.* de Core al ERP', () => {
  // Cada caso mide SUS entregas: las que dejó el caso anterior en el mismo tenant de prueba se retiran.
  beforeEach(async () => {
    if (harness)
      await harness.sequelize.query('DELETE FROM platform_ops.outbound_event_deliveries WHERE _tenant_id = $t', {
        bind: { t: harness.tenantId },
      });
  });

  async function report(h: LoanBookHarness, loan: Loan) {
    return h.claims.submit({
      tenantId: h.tenantId,
      customerId: loan.customerId,
      body: {
        installmentId: String(loan.installments[0]!.id),
        amount: '333.33',
        payerReference: 'TRX-IT-P14',
        contentType: 'image/jpeg',
        storageKey: `files/${h.tenantId}/${loan.customerId}/payment_proof/${randomUUID()}.jpg`,
        sizeBytes: 1024,
      } as never,
      currentUser: customerUser(loan.customerId),
    });
  }

  const confirm = (h: LoanBookHarness, claimId: string) =>
    h.partnerClaims.decide({
      tenantId: h.tenantId,
      partnerProfileId: PARTNER,
      claimId,
      body: { verified: true },
      currentUser: merchantOf(PARTNER),
    });

  const deliveriesOf = (h: LoanBookHarness, installmentId: string) =>
    h.query<{ event_code: string; aggregate_version: string; status: string; attempts: number; envelope: Record<string, unknown> }>(
      `SELECT event_code, aggregate_version::text AS aggregate_version, status, attempts, envelope
         FROM platform_ops.outbound_event_deliveries
        WHERE _tenant_id = $tenantId AND aggregate_id = $installmentId ORDER BY aggregate_version`,
      { installmentId },
    );

  it('reportar y confirmar encolan su entrega al ERP en la misma transacción, con un sobre que cumple el contrato', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    const claim = await report(h, loan);
    await confirm(h, claim.claimId);

    const deliveries = await deliveriesOf(h, String(loan.installments[0]!.id));
    expect(deliveries.map((d) => [d.event_code, d.aggregate_version, d.status])).toEqual([
      ['payment.reported', '1', 'pending'],
      ['payment.confirmed', '2', 'pending'],
    ]);
    for (const delivery of deliveries) expect(validateEnvelope(registry, topics, delivery.envelope)).toEqual([]);
    expect(deliveries[1]!.envelope).toMatchObject({
      tenantId: h.tenantId,
      payload: { loanId: loan.loanId, installmentId: String(loan.installments[0]!.id), partnerProfileId: PARTNER, amount: '333.33' },
    });
    expect(JSON.stringify(deliveries[0]!.envelope)).not.toContain('TRX-IT-P14');
  });

  it('si la confirmación cae después de escribir el evento, no queda ni evento ni entrega al ERP', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    const claim = await report(h, loan);
    const publish = h.events.publish.bind(h.events);
    jest.spyOn(h.events, 'publish').mockImplementation(async (...args) => {
      await publish(...args);
      throw new Error('caída después de encolar');
    });
    await expect(confirm(h, claim.claimId)).rejects.toThrow('caída después de encolar');
    expect((await deliveriesOf(h, String(loan.installments[0]!.id))).map((d) => d.event_code)).toEqual(['payment.reported']);
  });

  function fakeReceiver(responses: Array<number | 'timeout'>) {
    const calls: Array<{ eventKey: string; topic: string; verified: boolean }> = [];
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      const body = String(init.body);
      const headers = init.headers as Record<string, string>;
      const envelope = JSON.parse(body) as { eventKey: string; topic: string };
      calls.push({
        eventKey: envelope.eventKey,
        topic: envelope.topic,
        verified: verifyEventSignature({ secret: SECRET, header: headers[SIGNATURE_HEADER], rawBody: body, toleranceSeconds: 300 }).ok,
      });
      const next = responses.length > 1 ? responses.shift()! : responses[0]!;
      if (next === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      await new Promise((done) => setTimeout(done, 20));
      return new Response(next === 200 ? '{"outcome":"APPLIED"}' : 'x', { status: next });
    };
    return {
      calls,
      publisher: new SignedEventPublisher({
        url: 'http://erp.test/api/v1/integration/core/events',
        secret: SECRET,
        timeoutMs: 1000,
        fetchImpl,
      }),
    };
  }

  it('respeta el orden por cuota: la versión 2 no sale mientras la 1 falla; al recuperarse salen 1 y 2, una vez cada una', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    const claim = await report(h, loan);
    await confirm(h, claim.claimId);
    const receiver = fakeReceiver([503, 'timeout', 200]);
    const service = new ErpEventDeliveryService(h.sequelize, receiver.publisher, POLICY);

    await service.deliverPending({ tenantId: h.tenantId, limit: 50 });
    await new Promise((done) => setTimeout(done, 5));
    await service.deliverPending({ tenantId: h.tenantId, limit: 50 });
    expect(receiver.calls.map((c) => c.topic)).toEqual(['payment.reported', 'payment.reported']);

    for (let i = 0; i < 4; i += 1) {
      await new Promise((done) => setTimeout(done, 5));
      await service.deliverPending({ tenantId: h.tenantId, limit: 50 });
    }
    expect(receiver.calls.map((c) => c.topic)).toEqual(['payment.reported', 'payment.reported', 'payment.reported', 'payment.confirmed']);
    expect(receiver.calls.every((c) => c.verified)).toBe(true);
    expect((await deliveriesOf(h, String(loan.installments[0]!.id))).map((d) => [d.status, d.attempts])).toEqual([
      ['delivered', 3],
      ['delivered', 1],
    ]);
  });

  it('un rechazo de contrato (422) va a dead, visible, y bloquea las versiones siguientes de esa cuota', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    const claim = await report(h, loan);
    await confirm(h, claim.claimId);
    const receiver = fakeReceiver([422]);
    const service = new ErpEventDeliveryService(h.sequelize, receiver.publisher, POLICY);
    await service.deliverPending({ tenantId: h.tenantId, limit: 50 });
    await service.deliverPending({ tenantId: h.tenantId, limit: 50 });
    expect(receiver.calls.map((c) => c.topic)).toEqual(['payment.reported']);
    const rows = await deliveriesOf(h, String(loan.installments[0]!.id));
    expect(rows.map((d) => d.status)).toEqual(['dead', 'pending']);
  });

  it('dos workers a la vez no entregan dos veces la misma fila (lease + SKIP LOCKED)', async () => {
    if (!harness) return;
    const h = harness;
    const loans = await Promise.all([h.createLoan(PARTNER), h.createLoan(PARTNER), h.createLoan(PARTNER)]);
    for (const loan of loans) await report(h, loan);
    const receiver = fakeReceiver([200]);
    const a = new ErpEventDeliveryService(h.sequelize, receiver.publisher, POLICY);
    const b = new ErpEventDeliveryService(h.sequelize, receiver.publisher, POLICY);
    await Promise.all([a.deliverPending({ tenantId: h.tenantId, limit: 50 }), b.deliverPending({ tenantId: h.tenantId, limit: 50 })]);
    const keys = receiver.calls.map((c) => c.eventKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const loan of loans) {
      expect((await deliveriesOf(h, String(loan.installments[0]!.id))).map((d) => d.status)).toEqual(['delivered']);
    }
  });

  it('sin receptor configurado no reserva nada: las entregas quedan pending', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    await report(h, loan);
    const result = await new ErpEventDeliveryService(h.sequelize, undefined, POLICY).deliverPending({ tenantId: h.tenantId, limit: 50 });
    expect(result.configured).toBe(false);
    expect((await deliveriesOf(h, String(loan.installments[0]!.id))).map((d) => [d.status, d.attempts])).toEqual([['pending', 0]]);
  });

  it('agotados los intentos por fallos transitorios, la entrega queda dead con el error redactado', async () => {
    if (!harness) return;
    const h = harness;
    const loan = await h.createLoan(PARTNER);
    await report(h, loan);
    const receiver = fakeReceiver([500]);
    const service = new ErpEventDeliveryService(h.sequelize, receiver.publisher, POLICY);
    for (let i = 0; i < 4; i += 1) {
      await service.deliverPending({ tenantId: h.tenantId, limit: 50 });
      await new Promise((done) => setTimeout(done, 5));
    }
    const rows = await h.query<{ status: string; attempts: number; last_error: string; last_http_status: number }>(
      `SELECT status, attempts, last_error, last_http_status FROM platform_ops.outbound_event_deliveries WHERE _tenant_id = $tenantId AND aggregate_id = $id`,
      { id: String(loan.installments[0]!.id) },
    );
    expect(rows).toEqual([{ status: 'dead', attempts: 3, last_error: 'HTTP 500 del receptor', last_http_status: 500 }]);
  });
});
