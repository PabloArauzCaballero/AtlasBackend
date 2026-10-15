/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { ExternalProviderCatalogRepository } from '../infrastructure/external-provider-catalog.repository.js';
import { ExternalProviderRequestRepository } from '../infrastructure/external-provider-request.repository.js';
import { mapCostPolicy } from './external-cost-policy.mapper.js';
import {
  envNumber,
  mockBaseUrlFor,
  productionIntegrationBlockers,
  providerModeFromEnv,
  toProviderCode,
} from './external-data-policy.util.js';
import { ExternalProviderRegistryService } from './external-provider-registry.service.js';
import { ExternalProviderReportingService } from './external-provider-reporting.service.js';

/** Aptitud de los proveedores para producción: readiness, auditoría de calidad y compuerta de producción. */
@Injectable()
export class ExternalProviderReadinessService {
  constructor(
    private readonly catalogRepository: ExternalProviderCatalogRepository,
    private readonly requestRepository: ExternalProviderRequestRepository,
    private readonly registry: ExternalProviderRegistryService,
    private readonly reporting: ExternalProviderReportingService,
  ) {}

  async getProviderReadiness() {
    const providers = await this.catalogRepository.listProviders();
    const readiness = [];
    for (const provider of providers) {
      const providerCode = String(provider.providerCode);
      const mode = providerModeFromEnv(providerCode, provider.defaultMode);
      const hasAdapter = this.registry.hasAdapter(providerCode);
      const policies = await this.catalogRepository.listCostPolicies(String(provider.id));
      const health = hasAdapter
        ? await this.registry.requireAdapter(providerCode).checkHealth(mode, mockBaseUrlFor(providerCode))
        : {
            providerCode,
            status: 'UNKNOWN' as const,
            mode,
            latencyMs: 0,
            checkedAt: new Date().toISOString(),
            errorCode: 'ADAPTER_NOT_REGISTERED',
          };
      const recentFailures = await this.requestRepository.countRequests({
        providerId: String(provider.id),
        from: new Date(Date.now() - envNumber('EXTERNAL_PROVIDER_CIRCUIT_BREAKER_WINDOW_MS', 10 * 60 * 1000)),
        statuses: ['FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTH_FAILED', 'RATE_LIMITED'],
      });
      const blockers: string[] = [...productionIntegrationBlockers(providerCode, mode)];
      if (!hasAdapter) blockers.push('ADAPTER_MISSING');
      if (provider.isActive === false || provider.providerStatus === 'DISABLED') blockers.push('PROVIDER_DISABLED');
      if (mode === 'disabled') blockers.push('MODE_DISABLED');
      if (policies.length === 0) blockers.push('NO_COST_POLICY');
      if (health.status === 'DOWN') blockers.push('HEALTH_DOWN');
      readiness.push({
        providerCode,
        name: provider.providerName,
        category: provider.providerCategory ?? provider.providerType,
        status: provider.providerStatus ?? (provider.isActive ? 'ACTIVE' : 'DISABLED'),
        mode,
        health,
        policies: policies.map((policy) => mapCostPolicy(policy)),
        recentFailures,
        readyForMock: hasAdapter && mode !== 'disabled',
        readyForProduction: hasAdapter && mode === 'production' && blockers.length === 0,
        blockers,
      });
    }
    return { generatedAt: new Date().toISOString(), readiness };
  }

  async auditExternalProvidersQuality() {
    const providers = await this.catalogRepository.listProviders();
    const findings: Array<{ severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; providerCode?: string; code: string; message: string }> = [];
    for (const provider of providers) {
      const providerCode = String(provider.providerCode);
      const policies = await this.catalogRepository.listCostPolicies(String(provider.id));
      if (!this.registry.hasAdapter(providerCode)) {
        findings.push({ severity: 'HIGH', providerCode, code: 'ADAPTER_MISSING', message: 'Provider configurado sin adapter registrado.' });
      }
      if (
        provider.requiresConsent === false &&
        ['IDENTITY', 'CREDIT_BUREAU', 'TELCO', 'SOCIAL', 'MESSAGING', 'DIGITAL_TRUST'].includes(String(provider.providerCategory))
      ) {
        findings.push({
          severity: 'HIGH',
          providerCode,
          code: 'CONSENT_DISABLED_FOR_SENSITIVE_PROVIDER',
          message: 'Proveedor sensible no debería operar sin consentimiento explícito.',
        });
      }
      if (policies.length === 0) {
        const missingCostPolicySeverity = String(provider.providerCategory) === 'CREDIT_BUREAU' ? 'CRITICAL' : 'MEDIUM';
        findings.push({
          severity: missingCostPolicySeverity,
          providerCode,
          code: 'MISSING_COST_POLICY',
          message: 'Provider sin política de costo/cuotas.',
        });
      }
      for (const policy of policies) {
        const highCost = ['HIGH', 'CRITICAL'].includes(policy.costTier);
        if (highCost && (!policy.requiresManualApproval || !policy.blockByDefault)) {
          findings.push({
            severity: 'CRITICAL',
            providerCode,
            code: 'HIGH_COST_NOT_BLOCKED',
            message: `Query ${policy.queryType} es costosa y no está bloqueada/manual.`,
          });
        }
        if (!Array.isArray(policy.allowedDecisionStagesJson) || policy.allowedDecisionStagesJson.length === 0) {
          findings.push({
            severity: 'MEDIUM',
            providerCode,
            code: 'POLICY_WITHOUT_ALLOWED_STAGES',
            message: `Query ${policy.queryType} no define etapas permitidas.`,
          });
        }
      }
      const mode = providerModeFromEnv(providerCode, provider.defaultMode);
      for (const blocker of productionIntegrationBlockers(providerCode, mode)) {
        findings.push({
          severity: 'CRITICAL',
          providerCode,
          code: 'PRODUCTION_INTEGRATION_GATE_BLOCKED',
          message: `Producción bloqueada: ${blocker}.`,
        });
      }
      if (mode === 'production' && (provider.providerStatus === 'MOCK_ONLY' || provider.providerStatus === 'SANDBOX_ONLY')) {
        findings.push({
          severity: 'CRITICAL',
          providerCode,
          code: 'PRODUCTION_MODE_IN_NON_PRODUCTION_PROVIDER',
          message: 'Modo production configurado en provider marcado como MOCK/SANDBOX.',
        });
      }
    }
    const critical = findings.filter((finding) => finding.severity === 'CRITICAL').length;
    const high = findings.filter((finding) => finding.severity === 'HIGH').length;
    const medium = findings.filter((finding) => finding.severity === 'MEDIUM').length;
    const score = Math.max(0, 100 - critical * 25 - high * 12 - medium * 5);
    return {
      generatedAt: new Date().toISOString(),
      score,
      rating: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D',
      findings,
      qualityGates: {
        canEnableProductionProviders: critical === 0,
        canRunCostlyProvidersAutomatically: false,
        scoringProviderCouplingAllowed: false,
      },
    };
  }

  async getProductionGate(input: { providerCode?: string; strict: boolean }) {
    const readiness = await this.getProviderReadiness();
    const quality = await this.auditExternalProvidersQuality();
    const sanitization = await this.reporting.auditResponseSanitization({
      limit: envNumber('EXTERNAL_PROVIDER_PROD_GATE_SANITIZATION_SAMPLE', 100),
    });
    const selected = input.providerCode
      ? readiness.readiness.filter((item) => item.providerCode === toProviderCode(input.providerCode ?? ''))
      : readiness.readiness;
    const providerFindings = input.providerCode
      ? quality.findings.filter((finding) => finding.providerCode === toProviderCode(input.providerCode ?? '') || !finding.providerCode)
      : quality.findings;
    const blockers: string[] = [];
    if (selected.length === 0) blockers.push('PROVIDER_NOT_FOUND');
    if (providerFindings.some((finding) => finding.severity === 'CRITICAL')) blockers.push('CRITICAL_QUALITY_FINDINGS');
    if (input.strict && providerFindings.some((finding) => finding.severity === 'HIGH')) blockers.push('HIGH_QUALITY_FINDINGS_STRICT_MODE');
    if (sanitization.qualityGate !== 'PASS') blockers.push('SANITIZATION_AUDIT_FAILED');
    for (const item of selected) {
      if (!item.readyForMock) blockers.push(`${item.providerCode}_NOT_READY_FOR_MOCK`);
      if (item.mode === 'production' && !item.readyForProduction) blockers.push(`${item.providerCode}_PRODUCTION_NOT_READY`);
      if (item.blockers.includes('NO_COST_POLICY')) blockers.push(`${item.providerCode}_NO_COST_POLICY`);
      if (item.blockers.includes('HEALTH_DOWN')) blockers.push(`${item.providerCode}_HEALTH_DOWN`);
    }
    const canPromoteProduction = blockers.length === 0;
    return {
      generatedAt: new Date().toISOString(),
      providerCode: input.providerCode ? toProviderCode(input.providerCode) : 'ALL',
      strict: input.strict,
      status: canPromoteProduction ? 'PASS' : 'FAIL',
      canPromoteProduction,
      blockers: [...new Set(blockers)],
      qualityScore: quality.score,
      sanitizationScore: sanitization.score,
      providers: selected.map((item) => ({
        providerCode: item.providerCode,
        mode: item.mode,
        healthStatus: item.health.status,
        readyForMock: item.readyForMock,
        readyForProduction: item.readyForProduction,
        blockers: item.blockers,
      })),
      requiredManualChecks: [
        'Contrato o convenio real firmado con proveedor productivo.',
        'Credenciales guardadas fuera del repositorio.',
        'Prueba sandbox exitosa con datos no sensibles.',
        'Legal/compliance aprobó consentimiento y propósito de tratamiento.',
        'Cost policy revisada por Riesgo/Finanzas antes de habilitar producción.',
      ],
    };
  }
}
