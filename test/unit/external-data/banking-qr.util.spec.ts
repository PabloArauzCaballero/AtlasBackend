import { describe, expect, it } from '@jest/globals';
import {
  buildTestBankQr,
  mapMockQrPayload,
} from '../../../src/modules/external-data/infrastructure/adapters/banking-generic/banking-qr.util.js';

describe('banking-qr.util', () => {
  it('buildTestBankQr: genera payload + imagen SVG y refleja el input', () => {
    const qr = buildTestBankQr({ amount: 250, currency: 'BOB', reference: 'R1' });
    expect(qr.status).toBe('QR_GENERATED');
    expect(qr.amount).toBe(250);
    expect(qr.currency).toBe('BOB');
    expect(qr.reference).toBe('R1');
    expect(qr.qrPayload).toBe('ATLAS-MOCK-QR|amount=250|currency=BOB|ref=R1');
    expect(qr.qrImageSvgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(qr.providerReference).toBe('BANK-QR-MOCK-001');
  });

  it('buildTestBankQr: aplica defaults y es determinista', () => {
    const a = buildTestBankQr({});
    const b = buildTestBankQr({});
    expect(a.amount).toBe(100);
    expect(a.currency).toBe('BOB');
    expect(a.qrId).toBe(b.qrId);
    expect(a.qrPayload).toBe(b.qrPayload);
    expect(a.qrImageSvgDataUrl).toBe(b.qrImageSvgDataUrl);
  });

  it('buildTestBankQr: el escenario "expired" marca QR_EXPIRED con expiresAt en el pasado', () => {
    const qr = buildTestBankQr({ scenario: 'expired' });
    expect(qr.status).toBe('QR_EXPIRED');
    expect(new Date(qr.expiresAt).getTime()).toBeLessThan(new Date('2026-06-01T00:00:00Z').getTime());
  });

  it('mapMockQrPayload: usa los campos del mock y cae a locales si faltan', () => {
    const mapped = mapMockQrPayload(
      { status: 'QR_GENERATED', qrId: 'QR-FROM-MOCK', qrPayload: 'P', qrImageSvgDataUrl: 'data:image/svg+xml;base64,X', amount: 99 },
      { amount: 5 },
    );
    expect(mapped.qrId).toBe('QR-FROM-MOCK');
    expect(mapped.amount).toBe(99);
    // reference no vino del mock -> cae al local (default MOCK-REF con el fallbackInput amount=5)
    expect(mapped.reference).toBe('MOCK-REF');
    expect(mapped.providerReference).toBe('BANK-QR-MOCK-001');
  });
});
