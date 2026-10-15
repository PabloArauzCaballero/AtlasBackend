/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { stableStringify } from '../../../common/utils/privacy/redaction.util.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { ExternalProviderCatalogRepository } from '../infrastructure/external-provider-catalog.repository.js';
import { ExternalConsentRepository } from '../infrastructure/external-consent.repository.js';
import { ExternalProviderRequestRepository } from '../infrastructure/external-provider-request.repository.js';
import { ExternalDataRequestDto } from '../external-data.schemas.js';
import { ExternalDataDecisionService } from './external-data-decision.service.js';
import { ExternalProviderCallService } from './external-provider-call.service.js';
import { ExternalProviderRegistryService } from './external-provider-registry.service.js';
import {
  consentPurposeCodes,
  isConsentRequiredError,
  mockBaseUrlFor,
  productionIntegrationBlockers,
  executionModeFor,
  toProviderCode,
} from './external-data-policy.util.js';
import { ExternalDataRequestResult, ExternalProviderExecutionInput } from '../domain/external-provider.types.js';
import { currentQaContext } from '../../../platform/security/qa-execution-context.js';

@Injectable()
export class ExternalDataExecutionService {
  constructor(
    private readonly catalogRepository: ExternalProviderCatalogRepository,
    private readonly consentRepository: ExternalConsentRepository,
    private readonly requestRepository: ExternalProviderRequestRepository,
    private readonly registry: ExternalProviderRegistryService,
    private readonly decision: ExternalDataDecisionService,
    private readonly call: ExternalProviderCallService,
  ) {}

  async executeExternalDataRequest(input: {
    tenantId: string;
    body: ExternalDataRequestDto;
    idempotencyKey?: string;
    requestedByUserId?: string;
    retryOfRequestId?: string;
    /**
     * Quién aprobó en línea una consulta de alto costo. Lo fija el BORDE con el actor autenticado y
     * sólo si es admin (`inlineApprovalBy`); `body.approvedByAdminId` no se lee nunca. Antes salía
     * del cuerpo, así que cualquier token —incluido el de un cliente— se autoaprobaba el buró y
     * dejaba la fila «approved_inline» a nombre de un admin que no había aprobado nada.
     */
    approvedByAdminId?: string;
    /** Prueba del portal interno con datos sintéticos; ver `validateConsent`. */
    syntheticProbe?: boolean;
  }): Promise<ExternalDataRequestResult> {
    const providerCode = toProviderCode(input.body.providerCode);
    const provider = await this.registry.requireProvider(providerCode);
    const adapter = this.registry.requireAdapter(providerCode);
    const policy = await this.catalogRepository.findCostPolicy(String(provider.id), input.body.queryType);
    const mode = executionModeFor(String(provider.providerCode), provider.defaultMode);
    const now = new Date();
    const requestPayloadHash = sha256Hex(stableStringify(input.body.input));
    if (input.idempotencyKey) {
      const existing = await this.requestRepository.findIdempotentProviderRequest(input.tenantId, input.idempotencyKey);
      if (existing) {
        this.decision.assertIdempotencyScopeMatches(existing, {
          providerId: String(provider.id),
          providerCode,
          customerId: input.body.customerId,
          queryType: input.body.queryType,
          purpose: input.body.purpose,
          decisionStage: input.body.decisionStage,
          requestPayloadHash,
        });
        return this.decision.replayIdempotentResult(existing, providerCode);
      }
    }
    let consent: { id: string } | null;
    try {
      consent = await this.validateConsent({
        tenantId: input.tenantId,
        customerId: input.body.customerId,
        providerCode,
        providerRequiresConsent: provider.requiresConsent !== false,
        purpose: input.body.purpose,
        syntheticProbe: input.syntheticProbe === true,
        mode,
      });
    } catch (error) {
      if (!isConsentRequiredError(error)) throw error;
      const request = await this.requestRepository.createProviderRequest({
        tenantId: input.tenantId,
        providerId: String(provider.id),
        customerId: input.body.customerId,
        requestType: input.body.queryType,
        purposeCode: input.body.purpose,
        decisionStage: input.body.decisionStage,
        modeUsed: mode,
        requestPayloadHash,
        idempotencyKey: input.idempotencyKey,
        responseStatus: 'CONSENT_REQUIRED',
        responseCode: 'CONSENT_REQUIRED',
        estimatedCostAmount: policy ? String(policy.unitCostAmount) : undefined,
        currency: policy?.currency ?? undefined,
        requestedByUserId: input.requestedByUserId,
        errorMessageSafe: 'CONSENT_REQUIRED',
        metadataJson: {
          providerCode,
          scenario: input.body.scenario ?? null,
          blockedBeforeExecution: true,
          retryOfRequestId: input.retryOfRequestId ?? null,
        },
        retryOfRequestId: input.retryOfRequestId,
        now,
      });
      return {
        requestId: String(request.id),
        providerCode,
        status: 'CONSENT_REQUIRED',
        reasonCode: 'CONSENT_REQUIRED',
        observations: [],
        features: {},
        manualReviewRequired: false,
        modeUsed: mode,
      };
    }

    let policyBlock = this.decision.evaluateCostPolicy({
      providerCode,
      policy,
      decisionStage: input.body.decisionStage,
      approvedByAdminId: input.approvedByAdminId,
    });
    if (!policyBlock.blocked) {
      policyBlock = await this.decision.evaluateQuotaPolicy({
        providerId: String(provider.id),
        providerCode,
        customerId: input.body.customerId,
        policy,
      });
    }

    if (!policyBlock.blocked) {
      policyBlock = await this.decision.evaluateCircuitBreaker({
        providerId: String(provider.id),
        providerCode,
        mode,
      });
    }

    if (!policyBlock.blocked) {
      const productionBlockers = productionIntegrationBlockers(providerCode, mode);
      if (productionBlockers.length > 0) {
        policyBlock = {
          blocked: true,
          status: 'PROVIDER_UNAVAILABLE',
          reasonCode: `PRODUCTION_GATE_BLOCKED:${productionBlockers.join(',')}`,
        };
      }
    }

    const cacheTtlSeconds = input.body.forceRefresh ? 0 : this.decision.cacheTtlSeconds(policy);
    if (!policyBlock.blocked && cacheTtlSeconds > 0) {
      const cachedRequest = await this.requestRepository.findReusableProviderRequest({
        tenantId: input.tenantId,
        providerId: String(provider.id),
        customerId: input.body.customerId,
        queryType: input.body.queryType,
        requestPayloadHash,
        since: new Date(Date.now() - cacheTtlSeconds * 1000),
      });
      if (cachedRequest) {
        const auditRequest = await this.requestRepository.createProviderRequest({
          tenantId: input.tenantId,
          providerId: String(provider.id),
          customerId: input.body.customerId,
          consentId: consent?.id ? String(consent.id) : undefined,
          requestType: input.body.queryType,
          purposeCode: input.body.purpose,
          decisionStage: input.body.decisionStage,
          modeUsed: mode,
          requestPayloadHash,
          idempotencyKey: input.idempotencyKey,
          responseStatus: 'CACHED',
          responseCode: 'CACHE_HIT',
          estimatedCostAmount: policy ? String(policy.unitCostAmount) : undefined,
          actualCostAmount: '0.0000',
          currency: policy?.currency ?? undefined,
          requestedByUserId: input.requestedByUserId,
          approvedByAdminId: input.approvedByAdminId,
          approvalStatus: input.approvedByAdminId ? 'approved_inline' : undefined,
          metadataJson: {
            providerCode,
            scenario: input.body.scenario ?? null,
            cachedFromRequestId: String(cachedRequest.id),
            cacheTtlSeconds,
            retryOfRequestId: input.retryOfRequestId ?? null,
          },
          cachedFromRequestId: String(cachedRequest.id),
          retryOfRequestId: input.retryOfRequestId,
          now,
        });
        const replayed = await this.decision.replayIdempotentResult(cachedRequest, providerCode);
        return {
          ...replayed,
          requestId: String(auditRequest.id),
          status: 'CACHED',
          reasonCode: 'CACHE_HIT',
          modeUsed: mode,
        };
      }
    }

    const request = await this.requestRepository.createProviderRequest({
      tenantId: input.tenantId,
      providerId: String(provider.id),
      customerId: input.body.customerId,
      consentId: consent?.id ? String(consent.id) : undefined,
      requestType: input.body.queryType,
      purposeCode: input.body.purpose,
      decisionStage: input.body.decisionStage,
      modeUsed: mode,
      requestPayloadHash,
      idempotencyKey: input.idempotencyKey,
      responseStatus: policyBlock.blocked ? policyBlock.status : 'PENDING',
      responseCode: policyBlock.reasonCode,
      estimatedCostAmount: policy ? String(policy.unitCostAmount) : undefined,
      currency: policy?.currency ?? undefined,
      requestedByUserId: input.requestedByUserId,
      approvedByAdminId: input.approvedByAdminId,
      approvalStatus: input.approvedByAdminId ? 'approved_inline' : undefined,
      metadataJson: { providerCode, scenario: input.body.scenario ?? null, retryOfRequestId: input.retryOfRequestId ?? null },
      retryOfRequestId: input.retryOfRequestId,
      now,
    });

    if (policyBlock.blocked) {
      return {
        requestId: String(request.id),
        providerCode,
        status: policyBlock.status,
        reasonCode: policyBlock.reasonCode,
        observations: [],
        features: {},
        manualReviewRequired: policyBlock.status === 'MANUAL_APPROVAL_REQUIRED',
        modeUsed: mode,
      };
    }

    const executionInput: ExternalProviderExecutionInput = {
      tenantId: input.tenantId,
      customerId: input.body.customerId,
      providerCode,
      queryType: input.body.queryType as ExternalProviderExecutionInput['queryType'],
      purpose: input.body.purpose,
      decisionStage: input.body.decisionStage as ExternalProviderExecutionInput['decisionStage'],
      mode,
      input: input.body.input,
      scenario: input.body.scenario as ExternalProviderExecutionInput['scenario'],
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      approvedByAdminId: input.approvedByAdminId,
      mockBaseUrl: mockBaseUrlFor(providerCode),
      // Contexto de corrida QA (H09): sólo existe si la petición trae una credencial firmada por el
      // worker y la corrida sigue viva; lo resuelve el middleware de `qa-orchestration`, nunca una
      // cabecera del cliente. Va aparte de `input`: no cambia el hash ni la idempotencia del negocio.
      qaContext: currentQaContext(),
    };

    return this.call.callAdapter({ request, providerId: String(provider.id), adapter, executionInput, policy });
  }

  private async validateConsent(input: {
    tenantId: string;
    customerId?: string;
    providerCode: string;
    providerRequiresConsent: boolean;
    purpose: string;
    syntheticProbe?: boolean;
    mode?: ExternalProviderExecutionInput['mode'];
  }) {
    if (!input.providerRequiresConsent) return null;
    // El consentimiento lo da una persona sobre SUS datos. Una prueba sin cliente contra el emulador
    // no consulta a nadie, así que no hay consentimiento que pedir. Contra un proveedor real
    // (`sandbox`/`production`) se sigue exigiendo: el `input` es libre y podría llevar un carnet real.
    if (input.syntheticProbe && !input.customerId && (input.mode === 'mock_local' || input.mode === 'mock_server')) {
      return null;
    }
    if (!input.customerId) throw new ForbiddenException('CONSENT_REQUIRED');
    const consent = await this.consentRepository.findCustomerConsent(
      input.tenantId,
      input.customerId,
      consentPurposeCodes(input.providerCode, input.purpose),
    );
    if (!consent) throw new ForbiddenException('CONSENT_REQUIRED');
    return consent;
  }
}
