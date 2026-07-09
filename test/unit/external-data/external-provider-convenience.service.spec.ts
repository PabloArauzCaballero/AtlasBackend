import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExternalProviderConvenienceService } from '../../../src/modules/external-data/application/external-provider-convenience.service.js';

/**
 * ATLAS-P12c (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9): último
 * servicio de `external-data` — con este archivo, los 6 servicios del módulo quedan cubiertos.
 * Cada método de conveniencia (`executeSegip`, `executeInfocenter`, etc.) fija
 * `providerCode`/`queryType`/`purpose`/`decisionStage` a mano. Un error de copy-paste aquí (por
 * ejemplo, `executeTelcoPhoneTrust` enviando `purpose: 'CONTACTABILITY'` en vez de
 * `'FRAUD_PREVENTION'`) enruta silenciosamente una consulta hacia el propósito/consentimiento
 * equivocado — exactamente el tipo de bug que un test de "el mapeo es el que dice ser" atrapa y
 * una revisión de código superficial no.
 */
describe('ExternalProviderConvenienceService', () => {
  function buildService() {
    const repository = { findProviderRequestByIdAndTenant: jest.fn(), findProviderById: jest.fn() };
    const execution = { executeExternalDataRequest: jest.fn(async () => ({ status: 'PENDING' })) };
    const service = new ExternalProviderConvenienceService(repository as never, execution as never);
    return { service, repository, execution };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function lastCallBody(execution: { executeExternalDataRequest: jest.Mock }) {
    return execution.executeExternalDataRequest.mock.calls[0][0].body as Record<string, unknown>;
  }

  describe('mapeo exacto de cada método de conveniencia', () => {
    it('executeSegip maps to providerCode SEGIP / IDENTITY_VERIFICATION / KYC_ONBOARDING / ONBOARDING', async () => {
      const { service, execution } = buildService();
      await service.executeSegip({ tenantId: 't1', customerId: 'c1', body: {} });
      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'SEGIP',
        queryType: 'IDENTITY_VERIFICATION',
        purpose: 'KYC_ONBOARDING',
        decisionStage: 'ONBOARDING',
      });
    });

    it('executeInfocenter maps to providerCode INFOCENTER / CREDIT_REPORT / CREDIT_EVALUATION, and forwards the caller-provided decisionStage (not a hardcoded one)', async () => {
      const { service, execution } = buildService();
      await service.executeInfocenter({ tenantId: 't1', customerId: 'c1', body: { documentNumber: '123', decisionStage: 'RENEWAL' } });
      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'INFOCENTER',
        queryType: 'CREDIT_REPORT',
        purpose: 'CREDIT_EVALUATION',
        decisionStage: 'RENEWAL',
      });
    });

    it('executeInfocenter only sends documentNumber as input, not the entire body (avoids leaking extra fields to the provider call)', async () => {
      const { service, execution } = buildService();
      await service.executeInfocenter({
        tenantId: 't1',
        customerId: 'c1',
        body: { documentNumber: '123', decisionStage: 'ORIGINATION', approvedByAdminId: 'admin-1' },
      });
      const body = lastCallBody(execution);
      expect(body.input).toEqual({ documentNumber: '123' });
    });

    it('executeQrPayment maps to QR_GENERIC / PAYMENT_VERIFICATION / PAYMENT_RECONCILIATION', async () => {
      const { service, execution } = buildService();
      await service.executeQrPayment({ tenantId: 't1', customerId: 'c1', body: {} });
      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'QR_GENERIC',
        queryType: 'PAYMENT_VERIFICATION',
        purpose: 'PAYMENT_RECONCILIATION',
        decisionStage: 'PAYMENT_RECONCILIATION',
      });
    });

    it('executeBankTransfer maps to BANKING_GENERIC / BANK_TRANSFER_VERIFICATION / PAYMENT_RECONCILIATION', async () => {
      const { service, execution } = buildService();
      await service.executeBankTransfer({ tenantId: 't1', customerId: 'c1', body: {} });
      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'BANKING_GENERIC',
        queryType: 'BANK_TRANSFER_VERIFICATION',
        purpose: 'PAYMENT_RECONCILIATION',
      });
    });

    it('executeTelcoPhoneTrust maps to TELCO_GENERIC / PHONE_TRUST_CHECK / FRAUD_PREVENTION / ONBOARDING — NOT contactability', async () => {
      const { service, execution } = buildService();
      await service.executeTelcoPhoneTrust({ tenantId: 't1', customerId: 'c1', body: {} });
      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'TELCO_GENERIC',
        queryType: 'PHONE_TRUST_CHECK',
        purpose: 'FRAUD_PREVENTION',
        decisionStage: 'ONBOARDING',
      });
    });

    it('executeWhatsapp maps to WHATSAPP_GENERIC / WHATSAPP_OTP_VERIFICATION / CONTACTABILITY', async () => {
      const { service, execution } = buildService();
      await service.executeWhatsapp({ tenantId: 't1', customerId: 'c1', body: {} });
      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'WHATSAPP_GENERIC',
        queryType: 'WHATSAPP_OTP_VERIFICATION',
        purpose: 'CONTACTABILITY',
        decisionStage: 'CONTACTABILITY',
      });
    });

    it('executeDigitalTrust maps to DIGITAL_TRUST_GENERIC / DIGITAL_TRUST_CHECK / DIGITAL_TRUST / ONBOARDING', async () => {
      const { service, execution } = buildService();
      await service.executeDigitalTrust({ tenantId: 't1', customerId: 'c1', body: {} });
      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'DIGITAL_TRUST_GENERIC',
        queryType: 'DIGITAL_TRUST_CHECK',
        purpose: 'DIGITAL_TRUST',
        decisionStage: 'ONBOARDING',
      });
    });

    it('executeFacebookCallback maps to FACEBOOK_META / SOCIAL_TRUST_CHECK / DIGITAL_TRUST — a different purpose than executeDigitalTrust despite the shared "trust" theme', async () => {
      const { service, execution } = buildService();
      await service.executeFacebookCallback({ tenantId: 't1', customerId: 'c1', body: {} });
      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'FACEBOOK_META',
        queryType: 'SOCIAL_TRUST_CHECK',
        purpose: 'DIGITAL_TRUST',
      });
    });

    it('every mapped-provider method forwards the whole body as "input" (except executeInfocenter, which is filtered)', async () => {
      const { service, execution } = buildService();
      await service.executeQrPayment({ tenantId: 't1', customerId: 'c1', body: { amount: 100, qrCode: 'abc' } });
      const body = lastCallBody(execution);
      expect(body.input).toEqual({ amount: 100, qrCode: 'abc' });
    });
  });

  describe('createFacebookConnectUrl', () => {
    it('generates a state token and embeds it consistently in both "state" and the connect URL', () => {
      const { service } = buildService();
      const result = service.createFacebookConnectUrl({ tenantId: 't1', customerId: 'c1' });
      expect(result.connectUrl).toContain(`state=${result.state}`);
      expect(result.connectUrl).toContain('customerId=c1');
    });

    it('two calls produce two different state tokens (not a static/predictable value)', () => {
      const { service } = buildService();
      const first = service.createFacebookConnectUrl({ tenantId: 't1', customerId: 'c1' });
      const second = service.createFacebookConnectUrl({ tenantId: 't1', customerId: 'c1' });
      expect(first.state).not.toBe(second.state);
    });

    it('defaults to mock_local mode when no env override is present', () => {
      delete process.env.FACEBOOK_META_MODE;
      delete process.env.META_FACEBOOK_MODE;
      const { service } = buildService();
      const result = service.createFacebookConnectUrl({ tenantId: 't1', customerId: 'c1' });
      expect(result.mode).toBe('mock_local');
    });
  });

  describe('retryProviderRequest', () => {
    it('throws NotFoundException when the original request does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.retryProviderRequest({ tenantId: 't1', requestId: 'missing', body: { input: {} } })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws RETRY_REQUIRES_NEW_INPUT when no sanitized input is supplied — by design, the original raw input is never stored/reused', async () => {
      const { service, repository } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        providerId: 'p1',
        customerId: 'c1',
      } as never);
      await expect(service.retryProviderRequest({ tenantId: 't1', requestId: 'req-1', body: {} })).rejects.toThrow(BadRequestException);
    });

    it('always sets forceRefresh: true, bypassing any cache from the original request', async () => {
      const { service, repository, execution } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'x',
        purposeCode: 'y',
        decisionStage: 'z',
      } as never);
      (repository.findProviderById as jest.Mock).mockResolvedValueOnce({ providerCode: 'INFOCENTER' } as never);

      await service.retryProviderRequest({ tenantId: 't1', requestId: 'req-1', body: { input: { documentNumber: '999' } } });

      const body = lastCallBody(execution);
      expect(body.forceRefresh).toBe(true);
    });

    it('links the retry to the original via retryOfRequestId', async () => {
      const { service, repository, execution } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'x',
        purposeCode: 'y',
        decisionStage: 'z',
      } as never);
      (repository.findProviderById as jest.Mock).mockResolvedValueOnce({ providerCode: 'INFOCENTER' } as never);

      await service.retryProviderRequest({ tenantId: 't1', requestId: 'req-1', body: { input: { documentNumber: '999' } } });

      const call = execution.executeExternalDataRequest.mock.calls[0][0] as { retryOfRequestId: string };
      expect(call.retryOfRequestId).toBe('req-1');
    });

    it('falls back to the original request providerCode/queryType/purpose/decisionStage when the caller does not override them', async () => {
      const { service, repository, execution } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'CREDIT_REPORT',
        purposeCode: 'CREDIT_EVALUATION',
        decisionStage: 'ORIGINATION',
      } as never);
      (repository.findProviderById as jest.Mock).mockResolvedValueOnce({ providerCode: 'INFOCENTER' } as never);

      await service.retryProviderRequest({ tenantId: 't1', requestId: 'req-1', body: { input: { documentNumber: '999' } } });

      expect(lastCallBody(execution)).toMatchObject({
        providerCode: 'INFOCENTER',
        queryType: 'CREDIT_REPORT',
        purpose: 'CREDIT_EVALUATION',
        decisionStage: 'ORIGINATION',
      });
    });

    it('an explicit override in the retry body takes precedence over the original request values', async () => {
      const { service, repository, execution } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        providerId: 'p1',
        customerId: 'c1',
        requestType: 'CREDIT_REPORT',
        purposeCode: 'CREDIT_EVALUATION',
        decisionStage: 'ORIGINATION',
      } as never);
      (repository.findProviderById as jest.Mock).mockResolvedValueOnce({ providerCode: 'INFOCENTER' } as never);

      await service.retryProviderRequest({
        tenantId: 't1',
        requestId: 'req-1',
        body: { input: { documentNumber: '999' }, decisionStage: 'RENEWAL' },
      });

      expect(lastCallBody(execution)).toMatchObject({ decisionStage: 'RENEWAL' });
    });

    it('defaults purpose/decisionStage to MANUAL_REVIEW when the original request has none and the caller supplies none either', async () => {
      const { service, repository, execution } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        providerId: 'p1',
        customerId: 'c1',
        requestType: null,
        purposeCode: null,
        decisionStage: null,
      } as never);
      (repository.findProviderById as jest.Mock).mockResolvedValueOnce({ providerCode: 'INFOCENTER' } as never);

      await service.retryProviderRequest({ tenantId: 't1', requestId: 'req-1', body: { input: { x: 1 } } });

      expect(lastCallBody(execution)).toMatchObject({ purpose: 'MANUAL_REVIEW', decisionStage: 'MANUAL_REVIEW' });
    });

    it('does not look up a provider at all when the original request has no providerId', async () => {
      const { service, repository, execution } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        providerId: null,
        customerId: 'c1',
      } as never);

      await service.retryProviderRequest({ tenantId: 't1', requestId: 'req-1', body: { providerCode: 'INFOCENTER', input: { x: 1 } } });

      expect(repository.findProviderById).not.toHaveBeenCalled();
      expect(lastCallBody(execution)).toMatchObject({ providerCode: 'INFOCENTER' });
    });
  });
});
