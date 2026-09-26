/**
 * @file P-14 — decisiones del receptor de eventos del ERP, sin base (la base se mide en integración).
 * @business Qué se rechaza para siempre (422), qué se acusa sin efecto y cuándo una versión es vieja.
 * @system Sequelize de mentira que responde por la forma de la sentencia; el controlador delega en el
 *   servicio y comprueba que la clave de la cabecera coincide con la del sobre.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';
import { ErpEventInboxService } from '../../../src/modules/erp-integration/erp-event-inbox.service.js';
import { ErpEventsController } from '../../../src/modules/erp-integration/erp-events.controller.js';
import type { IntegrationEnvelope } from '../../../src/modules/erp-integration/integration-envelope.schemas.js';

type Answers = { inserted?: boolean; advanced?: boolean; installmentExists?: boolean };

function fakeSequelize(answers: Answers = {}) {
  const statements: string[] = [];
  const query = jest.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes('INSERT INTO') && sql.includes('external_event_inbox')) return answers.inserted === false ? [] : [{ id: '1' }];
    if (sql.includes('external_aggregate_versions')) return answers.advanced === false ? [] : [{ v: '2' }];
    if (sql.includes('FROM') && sql.includes('loan_installments')) return answers.installmentExists === false ? [] : [{ id: '31' }];
    return [];
  });
  const sequelize = { query, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ id: 'tx' }) };
  return { sequelize: sequelize as unknown as Sequelize, statements };
}

const coreRef = { tenantId: '1', loanId: '9', installmentId: '31', partnerProfileId: '7' };

function settled(overrides: Partial<IntegrationEnvelope> = {}, payload: Record<string, unknown> = {}): IntegrationEnvelope {
  return {
    spec: 'atlas.erp.outbox/1',
    eventKey: 'coverage-settled-00000000-0000-4000-8000-000000000101',
    topic: 'b2b.coverage.settled',
    schemaVersion: 1,
    aggregate: { type: 'merchant_payable', id: '00000000-0000-4000-8000-000000000101', version: 2 },
    occurredAt: '2026-09-24T12:00:00.000Z',
    producer: 'atlas-erp',
    payload: {
      payableId: '00000000-0000-4000-8000-000000000101',
      installmentId: '00000000-0000-4000-8000-000000000102',
      purchaseId: '00000000-0000-4000-8000-000000000103',
      merchantAccountId: '00000000-0000-4000-8000-000000000104',
      consumerId: '00000000-0000-4000-8000-000000000105',
      settlementId: '00000000-0000-4000-8000-000000000106',
      settlementReference: 'LIQ-1',
      amount: '300.00',
      currency: 'BOB',
      paidAt: '2026-09-24T12:00:00.000Z',
      recoveryId: '00000000-0000-4000-8000-000000000107',
      coreRef,
      ...payload,
    },
    ...overrides,
  };
}

describe('ErpEventInboxService', () => {
  it('aplica una cobertura ligada a una cuota existente de Core', async () => {
    const { sequelize, statements } = fakeSequelize();
    await expect(new ErpEventInboxService(sequelize).receive(settled())).resolves.toEqual({ outcome: 'APPLIED' });
    expect(statements.some((sql) => sql.includes('installment_coverage_projections'))).toBe(true);
  });

  it('una entrega repetida es DUPLICATE y no toca la proyección', async () => {
    const { sequelize, statements } = fakeSequelize({ inserted: false });
    await expect(new ErpEventInboxService(sequelize).receive(settled())).resolves.toEqual({ outcome: 'DUPLICATE' });
    expect(statements.some((sql) => sql.includes('installment_coverage_projections'))).toBe(false);
  });

  it('una versión que no avanza es STALE y no toca la proyección', async () => {
    const { sequelize, statements } = fakeSequelize({ advanced: false });
    await expect(new ErpEventInboxService(sequelize).receive(settled())).resolves.toEqual({ outcome: 'STALE' });
    expect(statements.some((sql) => sql.includes('installment_coverage_projections'))).toBe(false);
  });

  it('una cuota que Core no conoce queda UNLINKED', async () => {
    const { sequelize } = fakeSequelize({ installmentExists: false });
    await expect(new ErpEventInboxService(sequelize).receive(settled())).resolves.toEqual({ outcome: 'UNLINKED' });
  });

  it('un movimiento de recuperación sin mapeo queda UNLINKED', async () => {
    const { sequelize } = fakeSequelize();
    const movement = settled(
      { topic: 'b2b.recovery.payment_applied', aggregate: { type: 'consumer_recovery', id: 'r-1', version: 2 } },
      {},
    );
    movement.payload = {
      recoveryId: '00000000-0000-4000-8000-000000000107',
      installmentId: '00000000-0000-4000-8000-000000000102',
      consumerId: '00000000-0000-4000-8000-000000000105',
      movementId: '00000000-0000-4000-8000-000000000108',
      movementType: 'PAYMENT',
      paymentReference: 'REC-1',
      amount: '100.00',
      currency: 'BOB',
      amountRecovered: '100.00',
      recoveryStatus: 'PARTIALLY_RECOVERED',
      coreRef: null,
    };
    await expect(new ErpEventInboxService(sequelize).receive(movement)).resolves.toEqual({ outcome: 'UNLINKED' });
  });

  it('un tópico sin consumidor en Core se acusa IGNORED sin validar su payload', async () => {
    const { sequelize } = fakeSequelize();
    await expect(
      new ErpEventInboxService(sequelize).receive(settled({ topic: 'accounting.period.closed', payload: { anything: 1 } })),
    ).resolves.toEqual({
      outcome: 'IGNORED',
    });
  });

  it('rechaza con 422 un sobre de otro productor, una versión de esquema desconocida o un payload fuera de contrato', async () => {
    const { sequelize, statements } = fakeSequelize();
    const service = new ErpEventInboxService(sequelize);
    await expect(service.receive(settled({ producer: 'atlas-core', spec: 'atlas.core.outbox/1' }))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.receive(settled({ schemaVersion: 2 }))).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.receive(settled({}, { amount: 300 }))).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.receive(settled({}, { amount: '0.00' }))).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(statements).toEqual([]);
  });
});

describe('ErpEventsController', () => {
  it('delega en la inbox y devuelve el desenlace; una clave de cabecera distinta de la del sobre es 400', async () => {
    const inbox = { receive: jest.fn(async () => ({ outcome: 'APPLIED' as const })) };
    const controller = new ErpEventsController(inbox as unknown as ErpEventInboxService);
    const envelope = settled();
    await expect(controller.receive(envelope.eventKey, envelope)).resolves.toEqual({ eventKey: envelope.eventKey, outcome: 'APPLIED' });
    await expect(controller.receive(undefined, envelope)).resolves.toEqual({ eventKey: envelope.eventKey, outcome: 'APPLIED' });
    await expect(controller.receive('otra-clave', envelope)).rejects.toBeInstanceOf(BadRequestException);
  });
});
