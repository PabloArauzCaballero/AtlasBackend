import { claveDeDesembolso, PurchaseDisbursementService } from '../../../src/modules/loans/application/purchase-disbursement.service';

/**
 * El último paso de una compra: con el pago inicial confirmado por el comercio, el préstamo nace solo.
 * Hasta el 2026-10-08 nadie lo desembolsaba y la compra quedaba sin cuotas ni cartera.
 */
describe('PurchaseDisbursementService', () => {
  function build(solicitudes: { id: string; customerId: string }[], falla?: string) {
    const credit = { findApplicationsWithConfirmedDownPayment: jest.fn(async () => solicitudes) };
    const disbursement = {
      disburse: jest.fn(async (input: { applicationId: string }) => {
        if (input.applicationId === falla) throw new Error('CREDIT_DECISION_EXPIRED');
        return { loanId: `L-${input.applicationId}` };
      }),
    };
    const service = new PurchaseDisbursementService(credit as never, disbursement as never);
    return { service, credit, disbursement };
  }

  it('desembolsa cada compra lista con una clave estable por solicitud, sin cuerpo ni usuario interno', async () => {
    const { service, credit, disbursement } = build([{ id: '4', customerId: '60' }]);

    const r = await service.disburseConfirmedPurchases({ tenantId: '1', limit: 20 });

    expect(credit.findApplicationsWithConfirmedDownPayment).toHaveBeenCalledWith({ tenantId: '1', limit: 20 });
    expect(disbursement.disburse).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '1', applicationId: '4', body: {}, idempotencyKey: 'purchase-disbursement:4' }),
    );
    expect(r).toEqual({ candidates: 1, disbursed: 1, failed: 0 });
  });

  it('la clave es la misma en cada pasada: un reintento devuelve el préstamo, no crea otro', () => {
    expect(claveDeDesembolso('4')).toBe(claveDeDesembolso('4'));
    expect(claveDeDesembolso('4')).not.toBe(claveDeDesembolso('5'));
  });

  it('una compra que falla no frena a las demás y queda para la próxima pasada', async () => {
    const { service, disbursement } = build(
      [
        { id: '4', customerId: '60' },
        { id: '5', customerId: '61' },
      ],
      '4',
    );

    const r = await service.disburseConfirmedPurchases({ tenantId: '1', limit: 20 });

    expect(disbursement.disburse).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ candidates: 2, disbursed: 1, failed: 1 });
  });
});
