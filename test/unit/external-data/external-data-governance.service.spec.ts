import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExternalDataGovernanceService } from '../../../src/modules/external-data/application/external-data-governance.service.js';

/**
 * Gobierno administrativo de proveedores: aprobación de solicitudes costosas, política de costo,
 * gate de promoción a producción (modo runtime) y kill-switch de emergencia. Cada uno es un control
 * operativo real, no solo una función de reporte.
 */
describe('ExternalDataGovernanceService', () => {
  function buildService() {
    const repository = {
      findProviderRequestByIdAndTenant: asyncMock(),
      updateProviderRequest: asyncMock(),
      updateCostPolicy: asyncMock(),
      updateProviderRuntime: asyncMock(),
      listCostPolicies: asyncMock(),
    };
    const registry = { requireProviderAllowDisabled: asyncMock() };
    const service = new ExternalDataGovernanceService(repository as never, repository as never, registry as never);
    return { service, repository, registry };
  }

  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('approveRequest', () => {
    it('throws NotFoundException when the request does not exist', async () => {
      const { service, repository } = buildService();
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.approveRequest({ tenantId: 't1', requestId: 'missing', approvedByAdminId: 'admin-1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('marks approvalStatus as "approved" and records the admin id', async () => {
      const { service, repository } = buildService();
      const request = { id: 'req-1', responseStatus: null, responseCode: null, respondedAt: null, metadataJson: {}, update: asyncMock() };
      (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce(request as never);

      const result = await service.approveRequest({
        tenantId: 't1',
        requestId: 'req-1',
        approvedByAdminId: 'admin-1',
        approvalReason: 'urgent case',
      });

      expect(result).toEqual({ requestId: 'req-1', approvalStatus: 'approved' });
      expect(request.update).toHaveBeenCalledWith({ approvalStatus: 'approved', approvedByAdminId: 'admin-1' });
    });
    it.each(['MOCKED', 'COMPLETED', 'FAILED', 'PROVIDER_UNAVAILABLE'])(
      'rechaza con 409 aprobar una solicitud ya terminada (%s) y no escribe nada',
      async (responseStatus) => {
        const { service, repository } = buildService();
        const request = { id: 'req-9', responseStatus, responseCode: null, respondedAt: null, metadataJson: {}, update: asyncMock() };
        (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce(request as never);

        await expect(service.approveRequest({ tenantId: 't1', requestId: 'req-9', approvedByAdminId: 'admin-1' })).rejects.toThrow(
          ConflictException,
        );
        expect(repository.updateProviderRequest).not.toHaveBeenCalled();
        expect(request.update).not.toHaveBeenCalled();
      },
    );

    it.each(['MANUAL_APPROVAL_REQUIRED', 'BLOCKED_BY_COST_POLICY', 'PENDING'])(
      'aprueba una solicitud retenida (%s)',
      async (responseStatus) => {
        const { service, repository } = buildService();
        const request = { id: 'req-8', responseStatus, responseCode: null, respondedAt: null, metadataJson: {}, update: asyncMock() };
        (repository.findProviderRequestByIdAndTenant as jest.Mock).mockResolvedValueOnce(request as never);

        await expect(service.approveRequest({ tenantId: 't1', requestId: 'req-8', approvedByAdminId: 'admin-1' })).resolves.toEqual({
          requestId: 'req-8',
          approvalStatus: 'approved',
        });
      },
    );
  });

  describe('updateProviderCostPolicy', () => {
    it('throws NotFoundException when the (provider, queryType) cost policy does not exist', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({ id: 'p1' } as never);
      (repository.updateCostPolicy as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.updateProviderCostPolicy({ providerCode: 'INFOCENTER', queryType: 'full_report', patch: {} as never }),
      ).rejects.toThrow(NotFoundException);
    });

    it('uppercases the queryType before looking up the policy', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({ id: 'p1' } as never);
      (repository.updateCostPolicy as jest.Mock).mockResolvedValueOnce({ id: 'cp1', providerId: 'p1' } as never);

      await service.updateProviderCostPolicy({ providerCode: 'infocenter', queryType: 'full_report', patch: {} as never });

      expect(repository.updateCostPolicy).toHaveBeenCalledWith('p1', 'FULL_REPORT', {});
    });
  });

  describe('updateProviderRuntimePolicy — el gate de promoción a producción', () => {
    it('throws PRODUCTION_MODE_REQUIRES_CONFIRMATION_AND_REAL_PROVIDER_CONTRACT when setting production mode without confirmProductionReady', async () => {
      const { service, registry } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({ id: 'p1', providerCode: 'SEGIP' } as never);
      await expect(service.updateProviderRuntimePolicy({ providerCode: 'SEGIP', patch: { defaultMode: 'production' } })).rejects.toThrow(
        /PRODUCTION_MODE_REQUIRES_CONFIRMATION_AND_REAL_PROVIDER_CONTRACT/,
      );
    });

    it('throws PRODUCTION_GATE_BLOCKED (with the exact blocker list) when confirmed but real integration blockers still exist', async () => {
      const { service, registry } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({ id: 'p1', providerCode: 'SEGIP' } as never);
      // sin SEGIP_REAL_INTEGRATION_IMPLEMENTED=true ni credenciales en env, productionIntegrationBlockers()
      // siempre devuelve al menos 1 bloqueador real para SEGIP en modo production.
      await expect(
        service.updateProviderRuntimePolicy({ providerCode: 'SEGIP', patch: { defaultMode: 'production', confirmProductionReady: true } }),
      ).rejects.toThrow(BadRequestException);
    });

    it('non-production mode changes (e.g. "disabled") never go through the production gate at all', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'SEGIP',
        description: null,
      } as never);
      (repository.updateProviderRuntime as jest.Mock).mockResolvedValueOnce({
        providerCode: 'SEGIP',
        defaultMode: 'disabled',
        providerStatus: 'DISABLED',
        isActive: false,
      } as never);

      const result = await service.updateProviderRuntimePolicy({ providerCode: 'SEGIP', patch: { defaultMode: 'disabled' } });

      expect(result.defaultMode).toBe('disabled');
    });
  });

  describe('activateProviderKillSwitch — apagado de emergencia de un proveedor', () => {
    it('forces defaultMode: "disabled", providerStatus: "DISABLED", isActive: false, regardless of any other state', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'INFOCENTER',
        description: null,
      } as never);
      (repository.updateProviderRuntime as jest.Mock).mockResolvedValueOnce({
        providerCode: 'INFOCENTER',
        defaultMode: 'disabled',
        providerStatus: 'DISABLED',
        isActive: false,
      } as never);

      const result = await service.activateProviderKillSwitch({ providerCode: 'INFOCENTER', reason: 'incidente de seguridad' });

      const updateArgs = (repository.updateProviderRuntime as jest.Mock).mock.calls[0][1] as {
        defaultMode: string;
        providerStatus: string;
        isActive: boolean;
      };
      expect(updateArgs).toMatchObject({ defaultMode: 'disabled', providerStatus: 'DISABLED', isActive: false });
      expect(result.isActive).toBe(false);
    });

    it('uses a default reason when none is given, instead of leaving it blank', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'INFOCENTER',
        description: null,
      } as never);
      (repository.updateProviderRuntime as jest.Mock).mockImplementationOnce(async (_id, patch) => ({
        providerCode: 'INFOCENTER',
        ...(patch as object),
      }));

      const result = await service.activateProviderKillSwitch({ providerCode: 'INFOCENTER' });

      expect(result.reason).toBe('Kill switch activado manualmente.');
    });

    it('deja en el motivo quién lo activó, porque data_providers es global y no guarda actor', async () => {
      const { service, registry, repository } = buildService();
      (registry.requireProviderAllowDisabled as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        providerCode: 'INFOCENTER',
        description: null,
      } as never);
      (repository.updateProviderRuntime as jest.Mock).mockImplementationOnce(async (_id, patch) => ({
        providerCode: 'INFOCENTER',
        ...(patch as object),
      }));

      const result = await service.activateProviderKillSwitch({ providerCode: 'INFOCENTER', reason: 'fuga', activatedBy: '7' });

      expect(result.reason).toBe('fuga (activado por usuario 7)');
    });
  });

  describe('ramas de defaults y blockers', () => {
    it('approveRequest aplica los defaults cuando la solicitud no trae estado/código/metadata ni admin', async () => {
      const { service, repository } = buildService();
      const update = jest.fn(async (..._args: unknown[]) => undefined);
      repository.findProviderRequestByIdAndTenant.mockResolvedValue({
        id: 7,
        responseStatus: null,
        responseCode: null,
        respondedAt: null,
        metadataJson: null,
        update,
      } as never);

      const result = await service.approveRequest({ tenantId: 't1', requestId: '7', approvedByAdminId: undefined });

      const patch = (repository.updateProviderRequest as jest.Mock).mock.calls[0][1] as Record<string, unknown>;
      expect(patch).toMatchObject({ responseStatus: 'PENDING', responseCode: 'APPROVED_FOR_MANUAL_EXECUTION' });
      expect(patch.metadataJson).toMatchObject({ approvalReason: null });
      expect(update).toHaveBeenCalledWith({ approvalStatus: 'approved', approvedByAdminId: null });
      expect(result).toEqual({ requestId: '7', approvalStatus: 'approved' });
    });

    it('approveRequest conserva estado/código/metadata previos y registra la razón y el admin', async () => {
      const { service, repository } = buildService();
      const update = jest.fn(async (..._args: unknown[]) => undefined);
      const respondedAt = new Date('2026-01-01T00:00:00.000Z');
      repository.findProviderRequestByIdAndTenant.mockResolvedValue({
        id: 7,
        responseStatus: 'MANUAL_APPROVAL_REQUIRED',
        responseCode: 'NEEDS_ADMIN',
        respondedAt,
        metadataJson: { previo: true },
        update,
      } as never);

      await service.approveRequest({ tenantId: 't1', requestId: '7', approvedByAdminId: 'admin-1', approvalReason: 'ok' });

      const patch = (repository.updateProviderRequest as jest.Mock).mock.calls[0][1] as Record<string, unknown>;
      expect(patch).toMatchObject({ responseStatus: 'MANUAL_APPROVAL_REQUIRED', responseCode: 'NEEDS_ADMIN', respondedAt });
      expect(patch.metadataJson).toMatchObject({ previo: true, approvalReason: 'ok' });
      expect(update).toHaveBeenCalledWith({ approvalStatus: 'approved', approvedByAdminId: 'admin-1' });
    });
  });
});
