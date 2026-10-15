/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { ExternalProviderCatalogRepository } from '../infrastructure/external-provider-catalog.repository.js';

type CostPolicy = Awaited<ReturnType<ExternalProviderCatalogRepository['findCostPolicy']>>;

/** Proyección pública de una política de costo de proveedor; `null` si no existe. */
export function mapCostPolicy(policy: CostPolicy) {
  if (!policy) return null;
  return {
    id: String(policy.id),
    providerId: String(policy.providerId),
    queryType: policy.queryType,
    unitCostAmount: policy.unitCostAmount,
    currency: policy.currency,
    costTier: policy.costTier,
    maxQueriesPerUserPerDay: policy.maxQueriesPerUserPerDay,
    maxQueriesPerUserPerMonth: policy.maxQueriesPerUserPerMonth,
    maxQueriesGlobalPerDay: policy.maxQueriesGlobalPerDay,
    allowedDecisionStagesJson: policy.allowedDecisionStagesJson ?? [],
    requiresManualApproval: policy.requiresManualApproval,
    requiresAdminRole: policy.requiresAdminRole,
    blockByDefault: policy.blockByDefault,
    cacheTtlSeconds: policy.cacheTtlSeconds,
    featureTtlSeconds: policy.featureTtlSeconds,
    retryMaxAttempts: policy.retryMaxAttempts,
    retryBackoffSeconds: policy.retryBackoffSeconds,
    active: policy.active,
    activeFrom: policy.activeFrom,
    activeTo: policy.activeTo,
  };
}
