/**
 * @file P-08 — contrato del aviso de pago hacia quien concilia la cuota (ERP, notificaciones).
 * @business Lo que sale del core cuando un cliente avisa y el comercio decide: quién puede decidir,
 *   qué evento sale, con qué identidad común (préstamo, cuota, comercio) y qué versión de agregado.
 * @system Dobles tipados, sin Nest ni base: fija la FORMA del contrato. La atomicidad y la
 *   concurrencia se miden contra PostgreSQL en test/integration/credit/payment-lifecycle.spec.ts.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator.js';
import { getEventDefinition } from '../../src/modules/events/event-registry.js';
import { MerchantPaymentClaimsController } from '../../src/modules/loan-payment-claims/merchant-payment-claims.controller.js';
import { PartnerPaymentClaimsService } from '../../src/modules/loan-payment-claims/partner-payment-claims.service.js';
import { INSTALLMENT_AGGREGATE, nextInstallmentVersion } from '../../src/modules/loan-payment-claims/payment-claims.shared.js';

type Published = { input: Record<string, unknown>; options: Record<string, unknown> };

const TRANSACTION = { LOCK: { UPDATE: 'UPDATE' }, marker: 'tx-del-caso' };

function build(options: { claimStatus?: string; claimPartner?: string; previousVersion?: string | null } = {}) {
  const published: Published[] = [];
  const claim = {
    id: '55',
    claimCode: 'PC-abc',
    loanId: '9',
    installmentId: '31',
    customerId: '24',
    partnerProfileId: options.claimPartner ?? '7',
    claimedAmount: '333.33',
    currencyCode: 'BOB',
    payerReference: 'TRX-1',
    status: options.claimStatus ?? 'pending_verification',
    decidedAt: null as Date | null,
    update: jest.fn(async (values: Record<string, unknown>) => Object.assign(claim, values)),
  };
  const claims = { findOne: jest.fn(async () => claim) };
  const payments = {
    registerPayment: jest.fn(async (..._args: unknown[]) => ({ paymentId: '700', paymentCode: 'PAY-1', duplicated: false })),
  };
  const partners = { requireProfile: jest.fn(async () => ({ id: '7', ownerMerchantUserId: '70' })) };
  const events = {
    publish: jest.fn(
      async (input: Record<string, unknown>, opts: Record<string, unknown>) => void published.push({ input, options: opts }),
    ),
  };
  const sequelize = {
    transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(TRANSACTION)),
    query: jest.fn(async () => [{ version: options.previousVersion ?? '1' }]),
  };
  const contexto = {
    lockLoan: jest.fn(async (..._args: unknown[]) => undefined),
    lockOpenInstallment: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const service = new PartnerPaymentClaimsService(
    claims as never,
    {} as never,
    {} as never,
    payments as never,
    partners as never,
    events as never,
    sequelize as never,
    contexto as never,
  );
  return { service, claim, payments, published, contexto };
}

const merchant = { sub: 'merchant:70', role: 'merchant', merchantUserId: '70' } as never;
const decideInput = (body: Record<string, unknown>, currentUser = merchant, partnerProfileId = '7') => ({
  tenantId: '1',
  partnerProfileId,
  claimId: '55',
  body: body as never,
  currentUser,
});

describe('P-08 · contrato del ciclo del aviso de pago', () => {
  it('el catálogo declara los tres eventos sobre el agregado cuota', () => {
    for (const code of ['payment.reported', 'payment.confirmed', 'payment.rejected']) {
      expect(getEventDefinition(code)?.allowedAggregateTypes).toContain(INSTALLMENT_AGGREGATE);
    }
  });

  it('sólo roles de comercio o internos llegan al endpoint de decisión: el cliente no está entre ellos', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MerchantPaymentClaimsController) as string[];
    expect(roles).toContain('merchant');
    expect(roles).not.toContain('customer');
  });

  it('el cliente no puede autoconfirmar aunque llegue al servicio: 403 sin cobrar', async () => {
    const { service, payments } = build();
    await expect(
      service.decide(decideInput({ verified: true }, { sub: 'customer:24', role: 'customer', customerId: '24' } as never)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(payments.registerPayment).not.toHaveBeenCalled();
  });

  it('un comprobante que llegó a OTRO comercio: 403 sin cobrar', async () => {
    const { service, payments } = build({ claimPartner: '8' });
    await expect(service.decide(decideInput({ verified: true }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(payments.registerPayment).not.toHaveBeenCalled();
  });

  it('un aviso ya decidido no se vuelve a decidir: 409 sin cobrar ni publicar', async () => {
    const { service, payments, published } = build({ claimStatus: 'verified' });
    await expect(service.decide(decideInput({ verified: true }))).rejects.toBeInstanceOf(ConflictException);
    expect(payments.registerPayment).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it('confirmar cobra con la clave del aviso y dentro de la MISMA transacción que el evento', async () => {
    const { service, payments, published, contexto } = build({ previousVersion: '1' });
    const result = await service.decide(decideInput({ verified: true }));

    expect(result).toEqual({ claimId: '55', status: 'verified', loanPaymentId: '700' });
    expect(contexto.lockOpenInstallment).toHaveBeenCalledWith('1', '9', '31', TRANSACTION);
    expect(payments.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'PC-abc', transaction: TRANSACTION }));
    expect(published).toHaveLength(1);
    expect(published[0]!.options).toEqual({ transaction: TRANSACTION });
  });

  it('payment.confirmed lleva la identidad común (préstamo, cuota, comercio), idempotencia y versión de agregado', async () => {
    const { service, published } = build({ previousVersion: '1' });
    await service.decide(decideInput({ verified: true }));

    expect(published[0]!.input).toMatchObject({
      eventCode: 'payment.confirmed',
      aggregateType: 'installment',
      aggregateId: '31',
      aggregateVersion: 2,
      idempotencyKey: 'PC-abc-payment.confirmed',
      payload: expect.objectContaining({
        claimCode: 'PC-abc',
        loanId: '9',
        installmentId: '31',
        partnerProfileId: '7',
        customerId: '24',
        amount: '333.33',
        currencyCode: 'BOB',
        loanPaymentId: '700',
        aggregateVersion: 2,
      }),
    });
  });

  it('rechazar no cobra, exige el cerrojo del préstamo y publica payment.rejected con su motivo y versión', async () => {
    const { service, payments, published, contexto } = build({ previousVersion: '1' });
    const result = await service.decide(decideInput({ verified: false, reason: 'No llegó la transferencia' }));

    expect(result.status).toBe('rejected');
    expect(payments.registerPayment).not.toHaveBeenCalled();
    expect(contexto.lockLoan).toHaveBeenCalledWith('1', '9', TRANSACTION);
    expect(published[0]!.input).toMatchObject({
      eventCode: 'payment.rejected',
      aggregateVersion: 2,
      payload: expect.objectContaining({ reason: 'No llegó la transferencia', installmentId: '31' }),
    });
  });

  it('la versión del agregado es MAX+1 sobre los eventos de esa cuota, y 1 si no hay ninguno', async () => {
    const query = jest.fn(async (..._args: unknown[]): Promise<Array<{ version: string | null }>> => [{ version: null }]);
    expect(await nextInstallmentVersion({ query } as never, { tenantId: '1', installmentId: '31' }, {} as never)).toBe(1);
    query.mockResolvedValueOnce([{ version: '4' }]);
    expect(await nextInstallmentVersion({ query } as never, { tenantId: '1', installmentId: '31' }, {} as never)).toBe(5);
  });
});
