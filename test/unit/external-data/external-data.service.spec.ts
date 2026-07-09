import { describe, expect, it, jest } from '@jest/globals';
import { ExternalDataService } from '../../../src/modules/external-data/external-data.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5): último
 * servicio de `external-data` — con este archivo, los 6 servicios del módulo quedan cubiertos.
 * `createConsent` es el único método con lógica propia (el resto es delegación pura hacia los 5
 * servicios ya testeados); el caso más importante es cómo deriva `purposeCode` cuando hay un
 * `providerCode` explícito — un error aquí registraría el consentimiento bajo el propósito
 * equivocado.
 */
describe('ExternalDataService', () => {
  function buildService() {
    const repository = { createCustomerConsent: jest.fn() };
    const registry = { listProviders: jest.fn(), getProviderHealth: jest.fn() };
    const execution = { executeExternalDataRequest: jest.fn(), previewExternalDataRequest: jest.fn() };
    const convenience = { executeSegip: jest.fn(), executeInfocenter: jest.fn() };
    const evidence = { listCustomerConsents: jest.fn() };
    const governance = { approveRequest: jest.fn(), getProviderReadiness: jest.fn(), auditExternalProvidersQuality: jest.fn() };
    const service = new ExternalDataService(
      repository as never,
      registry as never,
      execution as never,
      convenience as never,
      evidence as never,
      governance as never,
    );
    return { service, repository, registry, execution, convenience, evidence, governance };
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

  describe('delegación pura hacia los 5 servicios especializados', () => {
    it('listProviders delegates to the registry, not to governance', async () => {
      const { service, registry, governance } = buildService();
      await service.listProviders();
      expect(registry.listProviders).toHaveBeenCalledTimes(1);
      expect(governance.getProviderReadiness).not.toHaveBeenCalled();
    });

    it('executeExternalDataRequest delegates to the execution service', async () => {
      const { service, execution } = buildService();
      const input = { tenantId: 't1', body: {} as never };
      await service.executeExternalDataRequest(input);
      expect(execution.executeExternalDataRequest).toHaveBeenCalledWith(input);
    });

    it('approveRequest delegates to governance, not execution', async () => {
      const { service, governance, execution } = buildService();
      const input = { tenantId: 't1', requestId: 'req-1', approvedByAdminId: 'admin-1' };
      await service.approveRequest(input);
      expect(governance.approveRequest).toHaveBeenCalledWith(input);
      expect(execution.executeExternalDataRequest).not.toHaveBeenCalled();
    });

    it('executeSegip delegates to convenience, not directly to execution', async () => {
      const { service, convenience, execution } = buildService();
      const input = { tenantId: 't1', customerId: 'c1', body: {} };
      await service.executeSegip(input);
      expect(convenience.executeSegip).toHaveBeenCalledWith(input);
      expect(execution.executeExternalDataRequest).not.toHaveBeenCalled();
    });

    it('listCustomerConsents delegates to evidence', async () => {
      const { service, evidence } = buildService();
      const input = { tenantId: 't1', customerId: 'c1' };
      await service.listCustomerConsents(input);
      expect(evidence.listCustomerConsents).toHaveBeenCalledWith(input);
    });
  });
});
