/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExternalProviderCatalogRepository } from '../infrastructure/external-provider-catalog.repository.js';
import { ExternalProviderRequestRepository } from '../infrastructure/external-provider-request.repository.js';
import { mapCostPolicy } from './external-cost-policy.mapper.js';
import { ExternalProviderRegistryService } from './external-provider-registry.service.js';
import { requireAwaitingApproval } from './external-request-approval.js';
import { productionIntegrationBlockers, toProviderCode } from './external-data-policy.util.js';

/** Gobierno administrativo de proveedores: aprobación de solicitudes, políticas de costo, modo runtime y kill switch. */
@Injectable()
export class ExternalDataGovernanceService {
  constructor(
    private readonly catalogRepository: ExternalProviderCatalogRepository,
    private readonly requestRepository: ExternalProviderRequestRepository,
    private readonly registry: ExternalProviderRegistryService,
  ) {}

  async approveRequest(input: { tenantId: string; requestId: string; approvedByAdminId: string | undefined; approvalReason?: string }) {
    const request = requireAwaitingApproval(await this.requestRepository.findProviderRequestByIdAndTenant(input.tenantId, input.requestId));
    await this.requestRepository.updateProviderRequest(request, {
      responseStatus: request.responseStatus ?? 'PENDING',
      responseCode: request.responseCode ?? 'APPROVED_FOR_MANUAL_EXECUTION',
      respondedAt: request.respondedAt ?? undefined,
      metadataJson: { ...(request.metadataJson ?? {}), approvalReason: input.approvalReason ?? null, approvedAt: new Date().toISOString() },
    });
    await request.update({ approvalStatus: 'approved', approvedByAdminId: input.approvedByAdminId ?? null });
    return { requestId: String(request.id), approvalStatus: 'approved' };
  }

  async getProviderCostPolicies(providerCode: string) {
    const provider = await this.registry.requireProviderAllowDisabled(toProviderCode(providerCode));
    const policies = await this.catalogRepository.listCostPolicies(String(provider.id));
    return policies.map((policy) => mapCostPolicy(policy));
  }

  async updateProviderCostPolicy(input: {
    providerCode: string;
    queryType: string;
    patch: Parameters<ExternalProviderCatalogRepository['updateCostPolicy']>[2];
  }) {
    const provider = await this.registry.requireProviderAllowDisabled(toProviderCode(input.providerCode));
    const policy = await this.catalogRepository.updateCostPolicy(String(provider.id), input.queryType.toUpperCase(), input.patch);
    if (!policy) throw new NotFoundException('Política de costo no encontrada.');
    return mapCostPolicy(policy);
  }

  async updateProviderRuntimePolicy(input: {
    providerCode: string;
    patch: { defaultMode?: string; providerStatus?: string; isActive?: boolean; confirmProductionReady?: boolean; reason?: string };
  }) {
    const provider = await this.registry.requireProviderAllowDisabled(toProviderCode(input.providerCode));
    if (input.patch.defaultMode === 'production') {
      if (input.patch.confirmProductionReady !== true) {
        throw new BadRequestException('PRODUCTION_MODE_REQUIRES_CONFIRMATION_AND_REAL_PROVIDER_CONTRACT');
      }
      const blockers = productionIntegrationBlockers(String(provider.providerCode), 'production');
      if (blockers.length > 0) {
        throw new BadRequestException({
          code: 'PRODUCTION_GATE_BLOCKED',
          message: 'No se puede activar producción porque faltan contrato, credenciales o implementación real verificable.',
          providerCode: String(provider.providerCode),
          blockers,
        });
      }
    }
    const descriptionSuffix = input.patch.reason
      ? `
Runtime change: ${input.patch.reason}`
      : '';
    const updated = await this.catalogRepository.updateProviderRuntime(String(provider.id), {
      defaultMode: input.patch.defaultMode,
      providerStatus: input.patch.providerStatus,
      isActive: input.patch.isActive,
      description: descriptionSuffix ? `${provider.description ?? ''}${descriptionSuffix}`.slice(0, 5000) : undefined,
    });
    return {
      providerCode: updated?.providerCode,
      defaultMode: updated?.defaultMode,
      providerStatus: updated?.providerStatus,
      isActive: updated?.isActive,
      reason: input.patch.reason ?? null,
    };
  }

  async activateProviderKillSwitch(input: { providerCode: string; reason?: string; activatedBy?: string }) {
    return this.updateProviderRuntimePolicy({
      providerCode: input.providerCode,
      patch: {
        defaultMode: 'disabled',
        providerStatus: 'DISABLED',
        isActive: false,
        reason: `${input.reason ?? 'Kill switch activado manualmente.'}${input.activatedBy ? ` (activado por usuario ${input.activatedBy})` : ''}`,
      },
    });
  }
}
