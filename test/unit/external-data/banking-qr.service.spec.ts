import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { BankingQrService } from '../../../src/modules/external-data/application/banking-qr.service.js';

/**
 * `BankingQrService` resuelve el modo del provider (igual que el resto de external-data) y delega en
 * el adapter bancario, devolviendo el QR + metadata, sin pasar por el pipeline de observaciones.
 */
describe('BankingQrService', () => {
  function build(defaultMode = 'mock_local') {
    const registry = { requireProviderAllowDisabled: jest.fn(async () => ({ defaultMode })) };
    const bankingAdapter = {
      generateQr: jest.fn(async () => ({
        status: 'QR_GENERATED',
        qrId: 'QR-X',
        qrPayload: 'ATLAS-MOCK-QR|amount=250|currency=BOB|ref=R1',
        qrImageSvgDataUrl: 'data:image/svg+xml;base64,X',
        amount: 250,
        currency: 'BOB',
        reference: 'R1',
        expiresAt: '2026-12-31T23:59:59Z',
        providerReference: 'BANK-QR-MOCK-001',
      })),
    };
    const service = new BankingQrService(registry as never, bankingAdapter as never);
    return { service, registry, bankingAdapter };
  }

  it('resuelve el modo y delega en el adapter, devolviendo el QR + meta', async () => {
    const { service, bankingAdapter } = build('mock_local');

    const result = await service.generateQr({ tenantId: 't1', customerId: 'c1', amount: 250, currency: 'BOB', reference: 'R1' });

    expect(result.providerCode).toBe('BANKING_GENERIC');
    expect(result.mode).toBe('mock_local');
    expect(result.customerId).toBe('c1');
    expect(result.qrId).toBe('QR-X');
    expect(result.status).toBe('QR_GENERATED');

    const call = (bankingAdapter.generateQr as jest.Mock).mock.calls[0][0] as {
      mode: string;
      providerCode: string;
      input: Record<string, unknown>;
    };
    expect(call.mode).toBe('mock_local');
    expect(call.providerCode).toBe('BANKING_GENERIC');
    expect(call.input).toEqual({ amount: 250, currency: 'BOB', reference: 'R1' });
  });

  /**
   * Hallazgo A-02: este flujo no pasa por el pipeline de políticas de `ExternalDataExecutionService`,
   * así que era el único punto donde un modo simulado en producción podía llegar hasta el cliente. Y
   * es el peor: un QR de COBRO simulado es un QR al que alguien le transfiere dinero real.
   */
  describe('portón de producción', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      delete process.env.EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION;
    });

    it('en producción con modo simulado responde 503 y NO llama al adapter', async () => {
      const { service, bankingAdapter } = build('mock_local');
      process.env.NODE_ENV = 'production';

      await expect(service.generateQr({ tenantId: 't1', customerId: 'c1', amount: 250, currency: 'BOB' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(bankingAdapter.generateQr).not.toHaveBeenCalled();
    });

    it('con el escape hatch explícito vuelve a generar el QR simulado', async () => {
      const { service, bankingAdapter } = build('mock_local');
      process.env.NODE_ENV = 'production';
      process.env.EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION = 'true';

      const result = await service.generateQr({ tenantId: 't1', customerId: 'c1', amount: 250, currency: 'BOB' });

      expect(result.qrId).toBe('QR-X');
      expect(bankingAdapter.generateQr).toHaveBeenCalledTimes(1);
    });
  });
});
