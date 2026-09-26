import { describe, expect, it, jest } from '@jest/globals';
import { PaymentInstructionService } from '../../../src/modules/loan-payment-claims/payment-instruction.service.js';

/**
 * Lo que el cliente ve al ir a pagar una cuota.
 *
 * Sólo un QR aprobado por una persona llega a la pantalla. Y cuando no llega, el motivo distingue
 * «el comercio no subió nada» de «lo subió y falta que lo aprueben»: son reclamaciones distintas a
 * personas distintas, y la app las explica con textos distintos.
 */
function construir(opciones: {
  activo?: { id: string; storageKey: string; contentType: string; sha256: string; status: string } | null;
  pendiente?: boolean;
}) {
  const partnerQr = {
    findLivePaymentQr: jest.fn(async () => opciones.activo ?? null),
    hasPaymentQrPendingReview: jest.fn(async () => opciones.pendiente ?? false),
  };
  const service = new PaymentInstructionService(
    /* storage */ { readObject: jest.fn(async () => Buffer.from('png')) } as never,
    /* partners */ { requireProfile: jest.fn(async () => ({ id: '7', tradeName: 'Tienda', legalName: 'Tienda SRL' })) } as never,
    partnerQr as never,
    /* claims */ { findOne: jest.fn(async () => null) } as never,
    /* contexto */ {
      requireOwnInstallment: jest.fn(async () => ({
        loan: { id: '5', loanCode: 'LN-1', currencyCode: 'BOB', creditApplicationId: '9' },
        installment: {
          id: '11',
          installmentNumber: 1,
          dueDate: '2026-10-01',
          status: 'pending',
          principalAmount: '100',
          interestAmount: '10',
          lateFeeAmount: '0',
          paidPrincipal: '0',
          paidInterest: '0',
          paidLateFee: '0',
        },
      })),
      resolvePartner: jest.fn(async () => '7'),
    } as never,
  );
  return { service, partnerQr };
}

const entrada = { tenantId: '1', customerId: '24', installmentId: '11', currentUser: { role: 'customer', customerId: '24' } } as never;

describe('PaymentInstructionService · el QR que ve el cliente', () => {
  it('con un QR aprobado, viaja embebido y sin motivo de ausencia', async () => {
    const { service } = construir({
      activo: { id: '3', storageKey: 'k', contentType: 'image/png', sha256: 'a'.repeat(64), status: 'active' },
    });
    const instruccion = await service.paymentInstruction(entrada);
    expect(instruccion.paymentQr?.imageDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(instruccion.paymentQrUnavailableReason).toBeNull();
  });

  it('con el QR todavía en revisión, no se enseña y el motivo lo dice', async () => {
    const { service } = construir({ activo: null, pendiente: true });
    const instruccion = await service.paymentInstruction(entrada);
    expect(instruccion.paymentQr).toBeNull();
    expect(instruccion.paymentQrUnavailableReason).toBe('PARTNER_PAYMENT_QR_PENDING_REVIEW');
  });

  it('sin ningún QR, el motivo es que el comercio no lo subió', async () => {
    const { service } = construir({ activo: null, pendiente: false });
    const instruccion = await service.paymentInstruction(entrada);
    expect(instruccion.paymentQrUnavailableReason).toBe('PARTNER_HAS_NO_PAYMENT_QR');
  });
});
