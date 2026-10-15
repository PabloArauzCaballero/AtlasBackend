/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { DataProviderModel, ExternalProviderCostPolicyModel, ProviderHealthLogModel } from '../../../database/models/index.js';
import { ProviderHealthResult } from '../domain/external-provider.types.js';

/** Agregado «catálogo de proveedores»: proveedores, políticas de costo y bitácora de salud. */
@Injectable()
export class ExternalProviderCatalogRepository {
  constructor(
    @InjectModel(DataProviderModel) private readonly dataProviderModel: typeof DataProviderModel,
    @InjectModel(ExternalProviderCostPolicyModel) private readonly costPolicyModel: typeof ExternalProviderCostPolicyModel,
    @InjectModel(ProviderHealthLogModel) private readonly providerHealthLogModel: typeof ProviderHealthLogModel,
  ) {}

  findProviderByCode(providerCode: string): Promise<DataProviderModel | null> {
    return this.dataProviderModel.findOne({ where: { providerCode } });
  }

  findProviderById(providerId: string): Promise<DataProviderModel | null> {
    return this.dataProviderModel.findByPk(providerId);
  }

  listProviders(): Promise<DataProviderModel[]> {
    return this.dataProviderModel.findAll({ order: [['provider_code', 'ASC']] });
  }

  listCostPolicies(providerId: string): Promise<ExternalProviderCostPolicyModel[]> {
    return this.costPolicyModel.findAll({ where: { providerId }, order: [['query_type', 'ASC']] });
  }

  async updateCostPolicy(
    providerId: string,
    queryType: string,
    patch: Partial<{
      unitCostAmount: number;
      currency: string;
      costTier: string;
      maxQueriesPerUserPerDay: number | null;
      maxQueriesPerUserPerMonth: number | null;
      maxQueriesGlobalPerDay: number | null;
      allowedDecisionStagesJson: string[];
      requiresManualApproval: boolean;
      requiresAdminRole: boolean;
      blockByDefault: boolean;
      cacheTtlSeconds: number | null;
      featureTtlSeconds: number | null;
      retryMaxAttempts: number | null;
      retryBackoffSeconds: number | null;
      active: boolean;
    }>,
  ): Promise<ExternalProviderCostPolicyModel | null> {
    const policy = await this.costPolicyModel.findOne({ where: { providerId, queryType } });
    if (!policy) return null;
    const update: Record<string, unknown> = { updatedAtValue: new Date() };
    if (patch.unitCostAmount !== undefined) update.unitCostAmount = patch.unitCostAmount.toFixed(4);
    if (patch.currency !== undefined) update.currency = patch.currency;
    if (patch.costTier !== undefined) update.costTier = patch.costTier;
    if (patch.maxQueriesPerUserPerDay !== undefined) update.maxQueriesPerUserPerDay = patch.maxQueriesPerUserPerDay;
    if (patch.maxQueriesPerUserPerMonth !== undefined) update.maxQueriesPerUserPerMonth = patch.maxQueriesPerUserPerMonth;
    if (patch.maxQueriesGlobalPerDay !== undefined) update.maxQueriesGlobalPerDay = patch.maxQueriesGlobalPerDay;
    if (patch.allowedDecisionStagesJson !== undefined) update.allowedDecisionStagesJson = patch.allowedDecisionStagesJson;
    if (patch.requiresManualApproval !== undefined) update.requiresManualApproval = patch.requiresManualApproval;
    if (patch.requiresAdminRole !== undefined) update.requiresAdminRole = patch.requiresAdminRole;
    if (patch.blockByDefault !== undefined) update.blockByDefault = patch.blockByDefault;
    if (patch.cacheTtlSeconds !== undefined) update.cacheTtlSeconds = patch.cacheTtlSeconds;
    if (patch.featureTtlSeconds !== undefined) update.featureTtlSeconds = patch.featureTtlSeconds;
    if (patch.retryMaxAttempts !== undefined) update.retryMaxAttempts = patch.retryMaxAttempts;
    if (patch.retryBackoffSeconds !== undefined) update.retryBackoffSeconds = patch.retryBackoffSeconds;
    if (patch.active !== undefined) update.active = patch.active;
    await policy.update(update);
    return policy;
  }

  async updateProviderRuntime(
    providerId: string,
    patch: Partial<{ defaultMode: string; providerStatus: string; isActive: boolean; description: string }>,
  ): Promise<DataProviderModel | null> {
    const provider = await this.dataProviderModel.findByPk(providerId);
    if (!provider) return null;
    const update: Record<string, unknown> = { updatedAtValue: new Date() };
    if (patch.defaultMode !== undefined) update.defaultMode = patch.defaultMode;
    if (patch.providerStatus !== undefined) update.providerStatus = patch.providerStatus;
    if (patch.isActive !== undefined) update.isActive = patch.isActive;
    if (patch.description !== undefined) update.description = patch.description;
    await provider.update(update);
    return provider;
  }

  findCostPolicy(providerId: string, queryType: string): Promise<ExternalProviderCostPolicyModel | null> {
    return this.costPolicyModel.findOne({ where: { providerId, queryType, active: true } });
  }

  createHealthLog(input: { providerId: string; health: ProviderHealthResult }): Promise<ProviderHealthLogModel> {
    return this.providerHealthLogModel.create({
      providerId: input.providerId,
      status: input.health.status,
      modeChecked: input.health.mode,
      latencyMs: input.health.latencyMs,
      checkedAt: new Date(input.health.checkedAt),
      errorCode: input.health.errorCode ?? null,
      errorMessageSafe: input.health.errorMessageSafe ?? null,
      metadataJson: { providerCode: input.health.providerCode },
    } as Record<string, unknown>);
  }
}
