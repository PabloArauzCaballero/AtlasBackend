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
  const mocks = (...names: string[]) => Object.fromEntries(names.map((n) => [n, jest.fn(async () => ({}))])) as Record<string, jest.Mock>;

  function buildService() {
    const repository = { createCustomerConsent: jest.fn() };
    const registry = mocks('listProviders', 'getProviderHealth');
    const execution = mocks('executeExternalDataRequest', 'previewExternalDataRequest');
    const convenience = mocks(
      'executeSegip',
      'executeInfocenter',
      'executeQrPayment',
      'executeBankTransfer',
      'executeTelcoPhoneTrust',
      'executeWhatsapp',
      'executeDigitalTrust',
      'createFacebookConnectUrl',
      'executeFacebookCallback',
      'retryProviderRequest',
    );
    const evidence = mocks(
      'listCustomerConsents',
      'revokeConsent',
      'getProviderRequest',
      'getCustomerObservations',
      'getCustomerFeatures',
      'getCustomerScoringInput',
      'getCustomerDecisionPackage',
      'rebuildFeatureSnapshotFromRequest',
    );
    const governance = mocks(
      'approveRequest',
      'getProviderReadiness',
      'auditExternalProvidersQuality',
      'getProviderCostPolicies',
      'updateProviderCostPolicy',
      'getProviderUsage',
      'auditIdempotencyKeys',
      'updateProviderRuntimePolicy',
      'activateProviderKillSwitch',
      'getRetentionPreview',
      'auditResponseSanitization',
      'getProductionGate',
      'getProviderSlaReport',
    );
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

    it('delega el resto de operaciones (passthrough) en su sub-servicio correcto', async () => {
      const s = buildService();
      const input = {
        tenantId: 't1',
        customerId: 'c1',
        requestId: 'r1',
        body: {},
        days: 7,
        limit: 5,
        strict: false,
        includeRawResponses: false,
        patch: {},
      } as never;
      const routes: Array<[string, 'execution' | 'convenience' | 'evidence' | 'governance']> = [
        ['previewExternalDataRequest', 'execution'],
        ['executeInfocenter', 'convenience'],
        ['executeQrPayment', 'convenience'],
        ['executeBankTransfer', 'convenience'],
        ['executeTelcoPhoneTrust', 'convenience'],
        ['executeWhatsapp', 'convenience'],
        ['executeDigitalTrust', 'convenience'],
        ['createFacebookConnectUrl', 'convenience'],
        ['executeFacebookCallback', 'convenience'],
        ['retryProviderRequest', 'convenience'],
        ['revokeConsent', 'evidence'],
        ['getProviderRequest', 'evidence'],
        ['getCustomerObservations', 'evidence'],
        ['getCustomerFeatures', 'evidence'],
        ['getCustomerScoringInput', 'evidence'],
        ['getCustomerDecisionPackage', 'evidence'],
        ['rebuildFeatureSnapshotFromRequest', 'evidence'],
        ['getProviderReadiness', 'governance'],
        ['auditExternalProvidersQuality', 'governance'],
        ['updateProviderCostPolicy', 'governance'],
        ['getProviderUsage', 'governance'],
        ['auditIdempotencyKeys', 'governance'],
        ['updateProviderRuntimePolicy', 'governance'],
        ['activateProviderKillSwitch', 'governance'],
        ['getRetentionPreview', 'governance'],
        ['auditResponseSanitization', 'governance'],
        ['getProductionGate', 'governance'],
        ['getProviderSlaReport', 'governance'],
      ];
      const svc = s.service as unknown as Record<string, (i: unknown) => Promise<unknown>>;
      for (const [method, collab] of routes) {
        await svc[method](input);
        expect((s[collab] as Record<string, jest.Mock>)[method]).toHaveBeenCalledTimes(1);
      }
    });

    it('getProviderHealth normaliza el código y getProviderCostPolicies delega en governance', async () => {
      const { service, registry, governance } = buildService();
      await service.getProviderHealth();
      expect(registry.getProviderHealth).toHaveBeenCalledWith(undefined);
      await service.getProviderHealth('cgip');
      expect(registry.getProviderHealth).toHaveBeenCalledWith('SEGIP'); // toProviderCode normaliza
      await service.getProviderCostPolicies('SEGIP');
      expect(governance.getProviderCostPolicies).toHaveBeenCalledWith('SEGIP');
    });
  });
});
