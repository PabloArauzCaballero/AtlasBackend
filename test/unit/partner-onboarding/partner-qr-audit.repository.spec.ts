import { describe, expect, it, jest } from '@jest/globals';
import {
  PARTNER_QR_CHANGED_ACTION,
  PartnerQrAuditRepository,
  maskAccountForAudit,
  snapshotQrForAudit,
} from '../../../src/modules/partner-onboarding/partner-qr-audit.repository.js';

/**
 * ERP-03 — la huella de cada cambio de QR: quién, cuándo, desde dónde y de qué cuenta a cuál, sin
 * dejar nunca un número de cuenta legible en la auditoría.
 */
describe('PartnerQrAuditRepository', () => {
  it.each([
    ['****7890', '****7890'],
    ['1234567890', '****7890'],
    ['BNB 100-200-3456', '****3456'],
    ['****', '****'],
    [null, null],
    ['', null],
  ])('enmascara %p como %p', (entrada, salida) => {
    expect(maskAccountForAudit(entrada)).toBe(salida);
  });

  it('la instantánea lleva el prefijo de la huella, nunca la huella entera ni la imagen', () => {
    const snapshot = snapshotQrForAudit({ id: '3', bankInstitutionCode: 'BNB', accountNumberMasked: '1234567890', sha256: 'f'.repeat(64) });
    expect(snapshot).toEqual({ qrId: '3', bankInstitutionCode: 'BNB', accountNumberMasked: '****7890', fingerprint: 'f'.repeat(12) });
  });

  it('escribe en la auditoría operativa, dentro de la transacción del cambio, con el comercio en el cuerpo', async () => {
    const model = { create: jest.fn(async (..._args: unknown[]) => ({})) };
    const repository = new PartnerQrAuditRepository(model as never);
    const transaction = { id: 'tx' } as never;
    const occurredAt = new Date('2026-10-09T10:00:00Z');

    await repository.recordQrChange(
      {
        tenantId: '1',
        partnerId: '7',
        qrKind: 'bank',
        branchId: null,
        previous: null,
        next: { qrId: '9', bankInstitutionCode: 'BNB', accountNumberMasked: '****1111', fingerprint: 'abc' },
        actor: {
          actorType: 'merchant_user',
          merchantUserId: '55',
          internalUserId: null,
          reauthenticated: true,
          ip: '10.0.0.1',
          userAgent: 'jest',
        },
        occurredAt,
      },
      { transaction },
    );

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: PARTNER_QR_CHANGED_ACTION,
        actorType: 'merchant_user',
        targetType: 'partner_profile',
        targetId: '7',
        ipAddress: '10.0.0.1',
        occurredAt,
        payloadJson: expect.objectContaining({ actorMerchantUserId: '55', reauthenticated: true, previous: null }),
      }),
      { transaction },
    );
  });
});
