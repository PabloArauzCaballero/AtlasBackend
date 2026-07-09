import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { ExternalProviderRegistryService } from '../../../src/modules/external-data/application/external-provider-registry.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 1): primer test real de
 * `external-data`, el módulo más grande sin ninguna cobertura (4,874 líneas). Se empieza por
 * `ExternalProviderRegistryService` porque es el servicio más pequeño y autocontenido (100
 * líneas, sin transacciones ni I/O propio más allá del repositorio), y porque resuelve un mapeo
 * de alias de proveedor (`CGIP` → `SEGIP`, `QR_BCB_GENERIC` → `QR_GENERIC`) que es exactamente
 * el tipo de regla "no obvia leyendo el nombre del método" que un test debe fijar por escrito.
 */
describe('ExternalProviderRegistryService', () => {
  function buildAdapter(providerCode: string) {
    return {
      providerCode,
      checkHealth: jest.fn(),
    };
  }

  function buildService() {
    const repository = {
      findProviderByCode: jest.fn(),
      listProviders: jest.fn(),
      createHealthLog: jest.fn(),
    };

    const segipAdapter = buildAdapter('SEGIP');
    const infoCenterAdapter = buildAdapter('INFOCENTER');
    const qrGenericAdapter = buildAdapter('QR_GENERIC');
    const bankingGenericAdapter = buildAdapter('BANKING_GENERIC');
    const telcoGenericAdapter = buildAdapter('TELCO_GENERIC');
    const facebookMetaAdapter = buildAdapter('FACEBOOK_META');
    const whatsappAdapter = buildAdapter('WHATSAPP');
    const digitalTrustGenericAdapter = buildAdapter('DIGITAL_TRUST_GENERIC');

    const service = new ExternalProviderRegistryService(
      repository as never,
      segipAdapter as never,
      infoCenterAdapter as never,
      qrGenericAdapter as never,
      bankingGenericAdapter as never,
      telcoGenericAdapter as never,
      facebookMetaAdapter as never,
      whatsappAdapter as never,
      digitalTrustGenericAdapter as never,
    );

    return { service, repository, adapters: { segipAdapter, infoCenterAdapter, qrGenericAdapter } };
  }

  describe('alias resolution (CGIP -> SEGIP, QR_BCB_GENERIC -> QR_GENERIC)', () => {
    it('hasAdapter treats CGIP as an alias of SEGIP', () => {
      const { service } = buildService();
      expect(service.hasAdapter('SEGIP')).toBe(true);
      expect(service.hasAdapter('CGIP')).toBe(true);
    });

    it('requireAdapter resolves CGIP to the SEGIP adapter instance, not a separate one', () => {
      const { service, adapters } = buildService();
      expect(service.requireAdapter('CGIP')).toBe(adapters.segipAdapter);
      expect(service.requireAdapter('SEGIP')).toBe(adapters.segipAdapter);
    });

    it('requireAdapter resolves QR_BCB_GENERIC to the QR_GENERIC adapter instance', () => {
      const { service, adapters } = buildService();
      expect(service.requireAdapter('QR_BCB_GENERIC')).toBe(adapters.qrGenericAdapter);
    });

    it('requireProvider looks up the provider by the canonical code (SEGIP) even when asked for CGIP', async () => {
      const { service, repository } = buildService();
      (repository.findProviderByCode as jest.Mock).mockResolvedValueOnce({ providerCode: 'SEGIP', isActive: true } as never);

      await service.requireProvider('CGIP');

      expect(repository.findProviderByCode).toHaveBeenCalledWith('SEGIP');
    });
  });

  describe('requireAdapter', () => {
    it('throws NotFoundException for a provider code with no registered adapter', () => {
      const { service } = buildService();
      expect(() => service.requireAdapter('UNKNOWN_PROVIDER')).toThrow(NotFoundException);
    });
  });

  describe('requireProvider vs requireProviderAllowDisabled', () => {
    it('requireProvider throws NotFoundException if the provider row does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findProviderByCode as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.requireProvider('INFOCENTER')).rejects.toThrow(NotFoundException);
    });

    it('requireProvider throws NotFoundException if the provider row exists but isActive is explicitly false', async () => {
      const { service, repository } = buildService();
      (repository.findProviderByCode as jest.Mock).mockResolvedValueOnce({ providerCode: 'INFOCENTER', isActive: false } as never);
      await expect(service.requireProvider('INFOCENTER')).rejects.toThrow(NotFoundException);
    });

    it('requireProvider succeeds when the provider exists and isActive is true', async () => {
      const { service, repository } = buildService();
      const provider = { providerCode: 'INFOCENTER', isActive: true };
      (repository.findProviderByCode as jest.Mock).mockResolvedValueOnce(provider as never);
      await expect(service.requireProvider('INFOCENTER')).resolves.toBe(provider);
    });

    it('requireProviderAllowDisabled succeeds even when isActive is false, unlike requireProvider', async () => {
      const { service, repository } = buildService();
      const provider = { providerCode: 'INFOCENTER', isActive: false };
      (repository.findProviderByCode as jest.Mock).mockResolvedValueOnce(provider as never);
      await expect(service.requireProviderAllowDisabled('INFOCENTER')).resolves.toBe(provider);
    });

    it('requireProviderAllowDisabled still throws NotFoundException if the provider row does not exist at all', async () => {
      const { service, repository } = buildService();
      (repository.findProviderByCode as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.requireProviderAllowDisabled('INFOCENTER')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listProviders', () => {
    it('maps status to isActive-derived value only when providerStatus is not already set', async () => {
      const { service, repository } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 1, providerCode: 'A', providerName: 'A', providerStatus: null, isActive: true, providerCategory: 'kyc', providerType: 'kyc' },
        {
          id: 2,
          providerCode: 'B',
          providerName: 'B',
          providerStatus: null,
          isActive: false,
          providerCategory: 'kyc',
          providerType: 'kyc',
        },
        {
          id: 3,
          providerCode: 'C',
          providerName: 'C',
          providerStatus: 'MAINTENANCE',
          isActive: true,
          providerCategory: 'kyc',
          providerType: 'kyc',
        },
      ] as never);

      const result = await service.listProviders();

      expect(result[0].status).toBe('ACTIVE');
      expect(result[1].status).toBe('DISABLED');
      expect(result[2].status).toBe('MAINTENANCE');
    });
  });

  describe('getProviderHealth', () => {
    it('checks health for a single provider when providerCode is given', async () => {
      const { service, repository, adapters } = buildService();
      const provider = { id: 7, providerCode: 'SEGIP', defaultMode: 'live', isActive: true };
      (repository.findProviderByCode as jest.Mock).mockResolvedValueOnce(provider as never);
      (adapters.segipAdapter.checkHealth as jest.Mock).mockResolvedValueOnce({ status: 'up' } as never);

      const result = await service.getProviderHealth('SEGIP');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ status: 'up', providerCode: 'SEGIP' });
      expect(repository.createHealthLog).toHaveBeenCalledWith({ providerId: '7', health: { status: 'up' } });
    });

    it('checks health for every registered provider when no providerCode is given', async () => {
      const { service, repository, adapters } = buildService();
      (repository.listProviders as jest.Mock).mockResolvedValueOnce([
        { id: 1, providerCode: 'SEGIP', defaultMode: 'live', isActive: true },
        { id: 2, providerCode: 'INFOCENTER', defaultMode: 'live', isActive: true },
      ] as never);
      (adapters.segipAdapter.checkHealth as jest.Mock).mockResolvedValueOnce({ status: 'up' } as never);
      (adapters.infoCenterAdapter.checkHealth as jest.Mock).mockResolvedValueOnce({ status: 'down' } as never);

      const result = await service.getProviderHealth();

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.providerCode)).toEqual(['SEGIP', 'INFOCENTER']);
    });

    it('propagates NotFoundException when checking health for an unconfigured provider code', async () => {
      const { service, repository } = buildService();
      (repository.findProviderByCode as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.getProviderHealth('DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  describe('onModuleInit — fail-fast de configuración (ATLAS-ROBUSTEZ)', () => {
    const ORIGINAL_ENV = { ...process.env };
    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('does not throw when no provider is forced to production mode', () => {
      delete process.env.SEGIP_MODE;
      const { service } = buildService();
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('throws when SEGIP_MODE=production is set without its required credentials', () => {
      process.env.SEGIP_MODE = 'production';
      delete process.env.SEGIP_BASE_URL;
      delete process.env.SEGIP_CLIENT_ID;
      delete process.env.SEGIP_CLIENT_SECRET;
      const { service } = buildService();
      expect(() => service.onModuleInit()).toThrow(/SEGIP_MODE/);
    });
  });
});
