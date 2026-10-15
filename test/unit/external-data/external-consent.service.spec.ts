import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExternalConsentService } from '../../../src/modules/external-data/application/external-consent.service.js';

/**
 * Consentimiento del cliente para consultar proveedores externos. `createConsent` deriva el
 * `purposeCode` a partir del `providerCode` explícito — un error aquí registraría el consentimiento
 * bajo el propósito equivocado; `revokeConsent` valida pertenencia al cliente autenticado.
 */
describe('ExternalConsentService', () => {
  function buildService() {
    const repository = {
      createCustomerConsent: jest.fn(),
      listCustomerConsents: jest.fn(),
      findCustomerConsentByIdAndTenant: jest.fn(),
      revokeCustomerConsent: jest.fn(),
    };
    return { service: new ExternalConsentService(repository as never), repository };
  }

  describe('createConsent — derivación de purposeCode', () => {
    it('uses the purpose as-is when providerCode is absent (defaults to GENERAL)', async () => {
      const { service, repository } = buildService();
      (repository.createCustomerConsent as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', grantedAt: new Date() } as never);

      const result = await service.createConsent({
        tenantId: 't1',
        body: { customerId: 'c1', purpose: 'marketing', channel: 'app' } as never,
      });

      expect(result.purposeCode).toBe('marketing');
      expect(result.providerCode).toBe('GENERAL');
    });

    it('alta asistida por personal: fuerza el canal y deja el actor en user_agent', async () => {
      const { service, repository } = buildService();
      (repository.createCustomerConsent as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', grantedAt: new Date() } as never);

      await service.createConsent({
        tenantId: 't1',
        body: { customerId: 'c1', purpose: 'external_data', channel: 'app' } as never,
        userAgent: 'ua',
        assistedByUserId: 'u9',
      });

      expect((repository.createCustomerConsent as jest.Mock).mock.calls[0][0]).toMatchObject({
        channel: 'staff_assisted',
        userAgent: 'staff:u9 ua',
      });
    });

    it('prefixes the purpose with the lowercased provider code when one is given', async () => {
      const { service, repository } = buildService();
      (repository.createCustomerConsent as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', grantedAt: new Date() } as never);

      const result = await service.createConsent({
        tenantId: 't1',
        body: { customerId: 'c1', purpose: 'IDENTITY_CHECK', channel: 'app', providerCode: 'SEGIP' } as never,
      });

      expect(result.purposeCode).toBe('segip_identity_check');
    });

    it('normalizes CGIP to its canonical SEGIP code before deriving purposeCode', async () => {
      const { service, repository } = buildService();
      (repository.createCustomerConsent as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', grantedAt: new Date() } as never);

      const result = await service.createConsent({
        tenantId: 't1',
        body: { customerId: 'c1', purpose: 'check', channel: 'app', providerCode: 'CGIP' } as never,
      });

      expect(result.providerCode).toBe('SEGIP');
      expect(result.purposeCode).toBe('segip_check');
    });

    it('always reports accepted: true for a created consent', async () => {
      const { service, repository } = buildService();
      (repository.createCustomerConsent as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', grantedAt: new Date() } as never);
      const result = await service.createConsent({
        tenantId: 't1',
        body: { customerId: 'c1', purpose: 'marketing', channel: 'app' } as never,
      });
      expect(result.accepted).toBe(true);
    });
  });

  describe('revokeConsent', () => {
    it('throws NotFoundException when the consent does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findCustomerConsentByIdAndTenant as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.revokeConsent({ tenantId: 't1', consentId: 'missing' })).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a customerId is given and does not match the consent owner', async () => {
      const { service, repository } = buildService();
      (repository.findCustomerConsentByIdAndTenant as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', customerId: 'c1' } as never);
      await expect(service.revokeConsent({ tenantId: 't1', consentId: 'consent-1', customerId: 'someone-else' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.revokeCustomerConsent).not.toHaveBeenCalled();
    });

    it('does not check ownership at all when customerId is omitted (internal/operations use)', async () => {
      const { service, repository } = buildService();
      (repository.findCustomerConsentByIdAndTenant as jest.Mock).mockResolvedValueOnce({ id: 'consent-1', customerId: 'c1' } as never);
      (repository.revokeCustomerConsent as jest.Mock).mockResolvedValueOnce({
        id: 'consent-1',
        customerId: 'c1',
        revokedAt: new Date(),
      } as never);

      const result = await service.revokeConsent({ tenantId: 't1', consentId: 'consent-1' });

      expect(result.revoked).toBe(true);
    });
  });

  describe('proyecciones de lectura', () => {
    it('listCustomerConsents proyecta el consentimiento', async () => {
      const { service, repository } = buildService();
      repository.listCustomerConsents.mockResolvedValue([
        { id: 1, customerId: 9, purposeCode: 'KYC', granted: true, grantedAt: null, revokedAt: null, channel: 'web' },
      ] as never);
      const result = await service.listCustomerConsents({ tenantId: 't1', customerId: '9' });
      expect(result[0]).toMatchObject({ id: '1', customerId: '9', purposeCode: 'KYC', granted: true, channel: 'web' });
    });

    it('revokeConsent devuelve el consentimiento revocado; si la revocación no encuentra fila, NotFound', async () => {
      const { service, repository } = buildService();
      repository.findCustomerConsentByIdAndTenant.mockResolvedValue({ id: 5, customerId: 9 } as never);
      repository.revokeCustomerConsent.mockResolvedValue({ id: 5, customerId: 9, revokedAt: new Date('2026-01-01') } as never);
      const ok = await service.revokeConsent({ tenantId: 't1', consentId: '5', customerId: '9' });
      expect(ok).toMatchObject({ id: '5', customerId: '9', revoked: true });

      repository.revokeCustomerConsent.mockResolvedValue(null as never);
      await expect(service.revokeConsent({ tenantId: 't1', consentId: '5' })).rejects.toThrow('Consentimiento no encontrado.');
    });
  });
});
