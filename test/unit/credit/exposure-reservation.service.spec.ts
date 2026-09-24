import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { decisionExpiresAt, ExposureReservationService } from '../../../src/modules/credit/application/exposure-reservation.service.js';
import { OriginationConsentCheck } from '../../../src/modules/credit/application/origination-consent-check.service.js';

/**
 * P-11 · la reserva del cupo, con dobles: el ORDEN de las comprobaciones y los códigos que devuelve.
 * La concurrencia real (dos transacciones y el cerrojo del cliente) se mide contra PostgreSQL en
 * test/integration/credit/exposure-reservation.spec.ts.
 */
const NOW = new Date('2026-09-24T12:00:00.000Z');
const LATER = new Date('2026-09-24T18:00:00.000Z');
const TX = { marker: 'tx' } as never;

type Snapshot = { approved_limit: string | null; currency_code: string | null; fits: boolean | null };

function build(
  options: { customerFound?: boolean; existing?: Record<string, unknown> | null; snapshot?: Snapshot | null; updated?: number } = {},
) {
  const snapshot = options.snapshot === undefined ? { approved_limit: '1000.00', currency_code: 'BOB', fits: true } : options.snapshot;
  const sequelize = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return options.customerFound === false ? [] : [{ _id: '24' }];
      return snapshot ? [{ ...snapshot, loans_exposure: '900.00', reserved_exposure: '0' }] : [];
    }),
  };
  const model = {
    findOne: jest.fn(async () => options.existing ?? null),
    create: jest.fn(async (...args: unknown[]) => ({ id: 'r-new', ...(args[0] as Record<string, unknown>) })),
    update: jest.fn(async (..._args: unknown[]) => [options.updated ?? 1]),
  };
  const service = new ExposureReservationService(model as never, sequelize as never);
  return { service, model, sequelize };
}

const input = { tenantId: '1', customerId: '24', applicationId: '5', amount: '80.00', currencyCode: 'BOB', expiresAt: LATER, now: NOW };

describe('ExposureReservationService', () => {
  it('reserva cuando cabe, con el vencimiento de la decisión', async () => {
    const { service, model } = build();
    const created = await service.reserve(input, TX);
    expect(created).toEqual(expect.objectContaining({ status: 'reserved', amount: '80.00', expiresAt: LATER }));
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ creditApplicationId: '5' }), { transaction: TX });
  });

  it('cliente inexistente → 404 antes de leer nada más', async () => {
    const { service, model } = build({ customerFound: false });
    await expect(service.reserve(input, TX)).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('decisión vencida → CREDIT_DECISION_EXPIRED', async () => {
    const { service } = build();
    await expect(service.reserve({ ...input, expiresAt: NOW }, TX)).rejects.toThrow('CREDIT_DECISION_EXPIRED');
  });

  it.each([
    ['sin línea', { approved_limit: null, currency_code: null, fits: null }, 'CREDIT_LIMIT_UNKNOWN'],
    ['línea en otra moneda', { approved_limit: '1000.00', currency_code: 'USD', fits: true }, 'CREDIT_LIMIT_CURRENCY_MISMATCH'],
    ['no cabe', { approved_limit: '1000.00', currency_code: 'BOB', fits: false }, 'CREDIT_EXPOSURE_LIMIT_EXCEEDED'],
  ])('%s → %s (falla cerrado)', async (_name, snapshot, code) => {
    const { service, model } = build({ snapshot: snapshot as Snapshot });
    await expect(service.reserve(input, TX)).rejects.toThrow(code);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('sin fila de instantánea también falla cerrado', async () => {
    const { service } = build({ snapshot: null });
    await expect(service.reserve(input, TX)).rejects.toThrow('CREDIT_LIMIT_UNKNOWN');
  });

  it('una reserva viva de la misma solicitud se reutiliza (idempotente)', async () => {
    const existing = { id: 'r1', status: 'reserved', expiresAt: LATER };
    const { service, model } = build({ existing });
    await expect(service.reserve(input, TX)).resolves.toBe(existing);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('una reserva ya consumida no se vuelve a reservar', async () => {
    const { service } = build({ existing: { id: 'r1', status: 'consumed', expiresAt: LATER } });
    await expect(service.reserve(input, TX)).rejects.toThrow('CREDIT_EXPOSURE_ALREADY_CONSUMED');
  });

  it('una reserva vencida se libera y se evalúa de nuevo contra el límite de hoy', async () => {
    const { service, model } = build({ existing: { id: 'r1', status: 'reserved', expiresAt: new Date(0) } });
    await service.reserve(input, TX);
    expect(model.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'released', releaseReason: 'expired' }), expect.anything());
    expect(model.create).toHaveBeenCalled();
  });

  it('consumir exige exactamente una reserva viva y no vencida', async () => {
    await expect(
      build({ updated: 1 }).service.consume({ tenantId: '1', applicationId: '5', loanId: '9', now: NOW }, TX),
    ).resolves.toBeUndefined();
    await expect(
      build({ updated: 0 }).service.consume({ tenantId: '1', applicationId: '5', loanId: '9', now: NOW }, TX),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('liberar dice si liberó: la segunda cancelación no devuelve cupo', async () => {
    expect(await build({ updated: 1 }).service.release({ tenantId: '1', applicationId: '5', reason: 'x', now: NOW })).toEqual({
      released: true,
    });
    expect(await build({ updated: 0 }).service.release({ tenantId: '1', applicationId: '5', reason: 'x', now: NOW })).toEqual({
      released: false,
    });
  });

  it('decisionExpiresAt: sin fecha de decisión es vencida; con fecha suma las horas de vigencia', () => {
    expect(decisionExpiresAt(null, 72).getTime()).toBe(0);
    expect(decisionExpiresAt(NOW, 6)).toEqual(LATER);
  });
});

describe('OriginationConsentCheck', () => {
  function check(facts: Record<string, string> | null) {
    const sequelize = { query: jest.fn(async (..._args: unknown[]) => (facts ? [facts] : [])) };
    return { check: new OriginationConsentCheck(sequelize as never), sequelize };
  }
  const ok = { missing_required: '0', revoked_after_decision: '0', pending_revocations: '0' };

  it.each([
    ['revocación pendiente de réplica', { ...ok, pending_revocations: '1' }, 'CONSENT_REVOCATION_PENDING_SYNC'],
    ['revocación posterior a la decisión', { ...ok, revoked_after_decision: '2' }, 'CONSENT_REVOKED_AFTER_DECISION'],
    ['documento obligatorio sin aceptar', { ...ok, missing_required: '1' }, 'REQUIRED_CONSENT_MISSING'],
  ])('bloquea la originación: %s → %s', async (_name, facts, code) => {
    await expect(check(facts).check.assertMayOriginate({ tenantId: '1', customerId: '24', decidedAt: NOW })).rejects.toThrow(code);
  });

  it('sin nada que lo impida, deja originar; sin fecha de decisión cuenta cualquier revocación', async () => {
    const { check: guard, sequelize } = check(ok);
    await expect(guard.assertMayOriginate({ tenantId: '1', customerId: '24', decidedAt: null })).resolves.toBeUndefined();
    expect(sequelize.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ bind: expect.objectContaining({ decidedAt: new Date(0) }) }),
    );
    await expect(check(null).check.assertMayOriginate({ tenantId: '1', customerId: '24', decidedAt: NOW })).resolves.toBeUndefined();
  });
});
