import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { stableStringify } from '../../../common/utils/privacy/redaction.util.js';
import { ExternalDataRepository } from '../external-data.repository.js';
import { NormalizedExternalObservation } from '../domain/external-provider.types.js';
import { CORE_SCORING_FEATURES, envNumber, featuresFromObservations } from './external-data-policy.util.js';

@Injectable()
export class ExternalDataEvidenceService {
  constructor(private readonly repository: ExternalDataRepository) {}

  async listCustomerConsents(input: { tenantId: string; customerId: string }) {
    const consents = await this.repository.listCustomerConsents(input.tenantId, input.customerId);
    return consents.map((consent) => ({
      id: String(consent.id),
      customerId: String(consent.customerId),
      purposeCode: consent.purposeCode,
      granted: consent.granted,
      grantedAt: consent.grantedAt,
      revokedAt: consent.revokedAt,
      channel: consent.channel,
    }));
  }

  async revokeConsent(input: { tenantId: string; consentId: string; customerId?: string }) {
    const existing = await this.repository.findCustomerConsentByIdAndTenant(input.tenantId, input.consentId);
    if (!existing) throw new NotFoundException('Consentimiento no encontrado.');
    if (input.customerId && String(existing.customerId) !== input.customerId) {
      throw new ForbiddenException('El consentimiento no corresponde al cliente autenticado.');
    }
    const consent = await this.repository.revokeCustomerConsent(input.tenantId, input.consentId, new Date());
    if (!consent) throw new NotFoundException('Consentimiento no encontrado.');
    return { id: String(consent.id), customerId: String(consent.customerId), revoked: true, revokedAt: consent.revokedAt };
  }

  async getProviderRequest(input: { tenantId: string; requestId: string }) {
    const request = await this.repository.findProviderRequestByIdAndTenant(input.tenantId, input.requestId);
    if (!request) throw new NotFoundException('Solicitud de provider externo no encontrada.');
    const responses = await this.repository.findProviderResponsesByRequestIdAndTenant(input.tenantId, input.requestId);
    return {
      id: String(request.id),
      providerId: request.providerId ? String(request.providerId) : null,
      customerId: request.customerId ? String(request.customerId) : null,
      requestType: request.requestType,
      purposeCode: request.purposeCode,
      decisionStage: request.decisionStage,
      modeUsed: request.modeUsed,
      responseStatus: request.responseStatus,
      responseCode: request.responseCode,
      approvalStatus: request.approvalStatus,
      estimatedCostAmount: request.estimatedCostAmount,
      actualCostAmount: request.actualCostAmount,
      currency: request.currency,
      requestedAt: request.requestedAt,
      respondedAt: request.respondedAt,
      latencyMs: request.latencyMs,
      errorMessageSafe: request.errorMessageSafe,
      metadataJson: request.metadataJson,
      responses: responses.map((response) => ({
        id: String(response.id),
        providerStatusCode: response.providerStatusCode,
        providerReference: response.providerReference,
        responseHash: response.responseHash,
        redactedPayloadJson: response.redactedPayloadJson,
        normalizedPayloadJson: response.normalizedPayloadJson,
        createdAt: response.createdAtValue,
      })),
    };
  }

  async getCustomerObservations(input: { tenantId: string; customerId: string; limit?: number }) {
    const observations = await this.repository.listCustomerObservations(input.tenantId, input.customerId, input.limit ?? 50);
    return observations.map((observation) => ({
      id: String(observation.id),
      customerId: observation.customerId ? String(observation.customerId) : null,
      observationCode: observation.observationCode,
      valueText: observation.valueText,
      valueNumber: observation.valueNumber,
      valueBoolean: observation.valueBoolean,
      valueJson: observation.valueJson,
      sourceProviderId: observation.sourceProviderId ? String(observation.sourceProviderId) : null,
      confidenceScore: observation.confidenceScore,
      verificationStatus: observation.verificationStatus,
      capturedAt: observation.capturedAt,
      derivationMethod: observation.derivationMethod,
    }));
  }

  async getCustomerFeatures(input: { tenantId: string; customerId: string; limit?: number }) {
    const snapshots = await this.repository.listCustomerFeatureSnapshots(input.tenantId, input.customerId, input.limit ?? 20);
    return snapshots.map((snapshot) => ({
      id: String(snapshot.id),
      customerId: snapshot.customerId ? String(snapshot.customerId) : null,
      snapshotReason: snapshot.snapshotReason,
      triggeringEntityId: snapshot.triggeringEntityId ? String(snapshot.triggeringEntityId) : null,
      featureSetVersion: snapshot.featureSetVersion,
      featuresJson: snapshot.featuresJson,
      missingFeaturesJson: snapshot.missingFeaturesJson,
      integrityHash: snapshot.integrityHash,
      createdAt: snapshot.createdAtValue,
    }));
  }

  async getCustomerScoringInput(input: { tenantId: string; customerId: string }) {
    const snapshots = await this.repository.listCustomerFeatureSnapshots(input.tenantId, input.customerId, 50);
    const maxAgeHours = envNumber('EXTERNAL_FEATURE_MAX_AGE_HOURS', 168);
    const now = Date.now();
    const features: Record<string, unknown> = {};
    const missing: Record<string, unknown> = {};
    const freshness: Array<{ snapshotId: string; snapshotReason: string | null; ageHours: number; stale: boolean }> = [];
    for (const snapshot of [...snapshots].reverse()) {
      Object.assign(features, snapshot.featuresJson ?? {});
      Object.assign(missing, snapshot.missingFeaturesJson ?? {});
      const ageHours = snapshot.createdAtValue ? Math.round(((now - snapshot.createdAtValue.getTime()) / 3_600_000) * 100) / 100 : 0;
      freshness.push({
        snapshotId: String(snapshot.id),
        snapshotReason: snapshot.snapshotReason,
        ageHours,
        stale: ageHours > maxAgeHours,
      });
    }
    return {
      customerId: input.customerId,
      generatedAt: new Date().toISOString(),
      featureSource: 'risk_feature_snapshots_only',
      maxAgeHours,
      features,
      missing,
      freshness,
      qualityFlags: {
        hasExternalFeatures: Object.keys(features).length > 0,
        hasStaleFeatures: freshness.some((item) => item.stale),
        rawProviderAccessBlocked: true,
        scoringMayCallProvidersDirectly: false,
      },
    };
  }

  async getCustomerDecisionPackage(input: {
    tenantId: string;
    customerId: string;
    includeRawResponses: boolean;
    featureMaxAgeHours?: number;
  }) {
    const maxAgeHours = input.featureMaxAgeHours ?? envNumber('EXTERNAL_FEATURE_MAX_AGE_HOURS', 168);
    const [features, observations, consents] = await Promise.all([
      this.getCustomerScoringInput({ tenantId: input.tenantId, customerId: input.customerId }),
      this.getCustomerObservations({ tenantId: input.tenantId, customerId: input.customerId, limit: 100 }),
      this.listCustomerConsents({ tenantId: input.tenantId, customerId: input.customerId }),
    ]);
    const requests = await this.repository.listProviderRequests({
      tenantId: input.tenantId,
      customerId: input.customerId,
      from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      limit: 100,
    });
    const latestRequests = await Promise.all(
      requests.slice(0, 20).map(async (request) => {
        const responses = input.includeRawResponses ? await this.repository.findProviderResponsesByRequestId(String(request.id)) : [];
        return {
          requestId: String(request.id),
          providerId: request.providerId ? String(request.providerId) : null,
          requestType: request.requestType,
          decisionStage: request.decisionStage,
          modeUsed: request.modeUsed,
          responseStatus: request.responseStatus,
          responseCode: request.responseCode,
          requestedAt: request.requestedAt,
          respondedAt: request.respondedAt,
          cost: request.actualCostAmount ?? request.estimatedCostAmount ?? null,
          currency: request.currency,
          responses: responses.map((response) => ({
            responseId: String(response.id),
            responseHash: response.responseHash,
            providerReference: response.providerReference,
            redactedPayloadJson: response.redactedPayloadJson,
            normalizedPayloadJson: response.normalizedPayloadJson,
          })),
        };
      }),
    );
    const missingCoreFeatures = CORE_SCORING_FEATURES.filter((feature) => !(feature in features.features));
    const staleFeatureSnapshots = features.freshness.filter((item) => item.ageHours > maxAgeHours);
    return {
      customerId: input.customerId,
      generatedAt: new Date().toISOString(),
      packageVersion: 'external-data-decision-package-v5',
      scoringInput: { ...features, maxAgeHours },
      observations,
      consents,
      latestRequests,
      riskFlags: {
        missingCoreFeatures,
        hasMissingCoreFeatures: missingCoreFeatures.length > 0,
        staleFeatureSnapshots,
        hasStaleFeatureSnapshots: staleFeatureSnapshots.length > 0,
        blockedRequestsCount: requests.filter((request) =>
          ['BLOCKED_BY_COST_POLICY', 'CONSENT_REQUIRED', 'MANUAL_APPROVAL_REQUIRED', 'RATE_LIMITED'].includes(
            String(request.responseStatus),
          ),
        ).length,
        failedRequestsCount: requests.filter((request) =>
          ['FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTH_FAILED'].includes(String(request.responseStatus)),
        ).length,
      },
      guidance: [
        'Usar este paquete para revisión manual o scoring; no llamar providers desde scoring.',
        'Si faltan features núcleo, ejecutar preflight antes de consultar proveedores costosos.',
        'Si hay snapshots obsoletos, usar forceRefresh solo cuando costo y consentimiento lo permitan.',
      ],
    };
  }

  async rebuildFeatureSnapshotFromRequest(input: { tenantId: string; requestId: string }) {
    const request = await this.repository.findProviderRequestByIdAndTenant(input.tenantId, input.requestId);
    if (!request) throw new NotFoundException('Solicitud de provider externo no encontrada.');
    if (!request.customerId) throw new BadRequestException('REQUEST_WITHOUT_CUSTOMER_CANNOT_REBUILD_FEATURES');
    const responses = await this.repository.findProviderResponsesByRequestIdAndTenant(input.tenantId, input.requestId);
    const normalized = responses[0]?.normalizedPayloadJson ?? {};
    const observations = Array.isArray(normalized.observations) ? (normalized.observations as NormalizedExternalObservation[]) : [];
    if (observations.length === 0) throw new BadRequestException('REQUEST_HAS_NO_NORMALIZED_OBSERVATIONS_TO_REBUILD');
    const provider = request.providerId ? await this.repository.findProviderById(String(request.providerId)) : null;
    const providerCode = provider ? String(provider.providerCode) : 'UNKNOWN';
    const features = featuresFromObservations(observations);
    const missingFeaturesJson = observations
      .filter((observation) => observation.valueString === 'DATA_NOT_AVAILABLE')
      .reduce<Record<string, unknown>>((acc, observation) => {
        acc[observation.featureKey] = 'DATA_NOT_AVAILABLE';
        return acc;
      }, {});
    const snapshot = await this.repository.createFeatureSnapshot({
      tenantId: input.tenantId,
      customerId: String(request.customerId),
      providerCode,
      requestId: input.requestId,
      featuresJson: features,
      missingFeaturesJson,
      integrityHash: sha256Hex(stableStringify(features)),
      now: new Date(),
    });
    return {
      requestId: input.requestId,
      providerCode,
      rebuilt: true,
      featureSnapshotId: String(snapshot.id),
      features,
      missingFeaturesJson,
      note: 'Reconstrucción no consulta al proveedor y no duplica costo. Útil cuando se corrige scoring input o mapeo de features.',
    };
  }
}
