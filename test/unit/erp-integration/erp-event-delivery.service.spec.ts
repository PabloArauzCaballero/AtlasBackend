/**
 * @file P-14 — la entrega de Core al ERP, sin base: qué estado deja cada respuesta y cuándo se rinde.
 * @business Un 2xx entrega; un transitorio reintenta con espera creciente y tope; agotado o rechazado
 *   queda muerto y visible; un lease perdido no escribe encima del proceso que lo retomó.
 * @system Sequelize de mentira; el orden por cuota, los leases reales y la concurrencia se miden en
 *   test/integration/erp-integration/erp-events.spec.ts.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { Sequelize } from 'sequelize-typescript';
import {
  ErpEventDeliveryService,
  nextDelayMs,
  type DeliveryPolicy,
} from '../../../src/modules/erp-integration/erp-event-delivery.service.js';
import type { DeliveryResult, SignedEventPublisher } from '../../../src/modules/erp-integration/signed-event-publisher.js';
import { enqueueOutboundDeliveries, destinationsFor } from '../../../src/platform/events/outbound-subscriptions.js';

const POLICY: DeliveryPolicy = { leaseMs: 60_000, maxAttempts: 3, retryBaseMs: 5_000, retryMaxMs: 60_000 };

function build(claimed: Array<{ id: string; attempts: number }>, answers: DeliveryResult[], settleRows = 1) {
  const updates: Array<Record<string, unknown>> = [];
  const query = jest.fn(async (sql: string, options: { bind: Record<string, unknown> }) => {
    if (sql.includes('WITH candidates'))
      return claimed.map((row) => ({ ...row, envelope: { eventKey: `k-${row.id}`, topic: 'payment.confirmed' } }));
    updates.push(options.bind);
    return Array.from({ length: settleRows }, () => ({ id: 'x' }));
  });
  const sequelize = { query, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({}) } as unknown as Sequelize;
  const publisher = { publish: jest.fn(async () => answers.shift()!) } as unknown as SignedEventPublisher;
  return { service: new ErpEventDeliveryService(sequelize, publisher, POLICY), updates, publisher };
}

describe('ErpEventDeliveryService', () => {
  it('ACK → delivered; transitorio → pending con backoff; rechazo o intentos agotados → dead', async () => {
    const { service, updates } = build(
      [
        { id: '1', attempts: 1 },
        { id: '2', attempts: 1 },
        { id: '3', attempts: 1 },
        { id: '4', attempts: 3 },
      ],
      [
        { outcome: 'ACK', httpStatus: 200 },
        { outcome: 'RETRY', httpStatus: 503, error: 'HTTP 503 del receptor' },
        { outcome: 'REJECTED', httpStatus: 422, error: 'HTTP 422 del receptor' },
        { outcome: 'RETRY', httpStatus: null, error: 'timeout' },
      ],
    );
    await expect(service.deliverPending({ tenantId: '1', limit: 10 })).resolves.toEqual({
      configured: true,
      claimed: 4,
      delivered: 1,
      retried: 1,
      dead: 2,
    });
    expect(updates.map((bind) => [bind.id, bind.status, bind.error])).toEqual([
      ['1', 'delivered', null],
      ['2', 'pending', 'HTTP 503 del receptor'],
      ['3', 'dead', 'HTTP 422 del receptor'],
      ['4', 'dead', 'timeout'],
    ]);
  });

  it('si otro proceso retomó la fila (lease perdido) no cuenta ni escribe su resultado', async () => {
    const { service } = build([{ id: '1', attempts: 1 }], [{ outcome: 'ACK', httpStatus: 200 }], 0);
    await expect(service.deliverPending({ tenantId: '1', limit: 10 })).resolves.toEqual({
      configured: true,
      claimed: 1,
      delivered: 0,
      retried: 0,
      dead: 0,
    });
  });

  it('sin publicador (sin URL ni secreto) no reserva nada', async () => {
    const query = jest.fn();
    const service = new ErpEventDeliveryService({ query } as unknown as Sequelize, undefined, POLICY);
    await expect(service.deliverPending({ tenantId: '1', limit: 10 })).resolves.toEqual({
      configured: false,
      claimed: 0,
      delivered: 0,
      retried: 0,
      dead: 0,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('la espera crece base·2^(n−1) con tope', () => {
    expect([1, 2, 3, 4, 10].map((attempts) => nextDelayMs(attempts, POLICY))).toEqual([5_000, 10_000, 20_000, 40_000, 60_000]);
  });
});

describe('enqueueOutboundDeliveries', () => {
  const row = {
    eventId: '00000000-0000-4000-8000-000000000021',
    eventCode: 'payment.confirmed',
    tenantId: '1',
    aggregateType: 'installment',
    aggregateId: '31',
    aggregateVersion: '2',
    schemaVersion: 1,
    createdAtValue: new Date('2026-09-24T12:00:00.000Z'),
    eventPayloadJson: { claimId: '55', amount: '1.00' },
  };

  it('sólo payment.* se suscribe al ERP', () => {
    expect(destinationsFor('payment.confirmed')).toEqual(['atlas-erp']);
    expect(destinationsFor('loan.disbursed')).toEqual([]);
  });

  it('encola con la transacción de quien publica y el sobre ya construido', async () => {
    const query = jest.fn(async () => []);
    const transaction = { id: 'tx' };
    await expect(enqueueOutboundDeliveries({ query } as unknown as Sequelize, row, transaction as never)).resolves.toBe(1);
    const [, options] = query.mock.calls[0] as unknown as [string, { transaction: unknown; bind: Record<string, string> }];
    expect(options.transaction).toBe(transaction);
    expect(JSON.parse(options.bind.envelope!)).toMatchObject({ eventKey: row.eventId, aggregate: { version: 2 }, tenantId: '1' });
  });

  it('no encola lo que no está suscrito y falla ruidosamente si falta la versión del agregado', async () => {
    const query = jest.fn(async () => []);
    await expect(enqueueOutboundDeliveries({ query } as unknown as Sequelize, { ...row, eventCode: 'loan.disbursed' })).resolves.toBe(0);
    await expect(enqueueOutboundDeliveries({ query } as unknown as Sequelize, { ...row, aggregateVersion: null })).rejects.toThrow(
      'OUTBOUND_EVENT_WITHOUT_ORDER',
    );
    await expect(enqueueOutboundDeliveries({ query } as unknown as Sequelize, { ...row, tenantId: null })).rejects.toThrow(
      'OUTBOUND_EVENT_WITHOUT_ORDER',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
