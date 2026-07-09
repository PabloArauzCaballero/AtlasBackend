import { Injectable } from '@nestjs/common';
import { ExternalDataEvidenceService } from './application/external-data-evidence.service.js';
import { ExternalDataExecutionService } from './application/external-data-execution.service.js';
import { ExternalDataGovernanceService } from './application/external-data-governance.service.js';
import { ExternalProviderRegistryService } from './application/external-provider-registry.service.js';
import { ExternalProviderConvenienceService } from './application/external-provider-convenience.service.js';
import { toProviderCode } from './application/external-data-policy.util.js';
import { ExternalDataRepository } from './external-data.repository.js';
import { ExternalConsentDto, ExternalDataRequestDto } from './external-data.schemas.js';

@Injectable()
export class ExternalDataService {
  constructor(
    private readonly repository: ExternalDataRepository,
    private readonly registry: ExternalProviderRegistryService,
    private readonly execution: ExternalDataExecutionService,
    private readonly convenience: ExternalProviderConvenienceService,
    private readonly evidence: ExternalDataEvidenceService,
    private readonly governance: ExternalDataGovernanceService,
  ) {}

  async createConsent(input: { tenantId: string; body: ExternalConsentDto; ipAddress?: string; userAgent?: string }) {
    const providerCode = input.body.providerCode ? toProviderCode(input.body.providerCode) : 'GENERAL';
    const purposeCode =
      providerCode === 'GENERAL' ? input.body.purpose : `${providerCode.toLowerCase()}_${input.body.purpose.toLowerCase()}`;
    const consent = await this.repository.createCustomerConsent({
      tenantId: input.tenantId,
      customerId: input.body.customerId,
      purposeCode,
      channel: input.body.channel,
      sessionId: input.body.sessionId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceFingerprintSnapshot: input.body.deviceFingerprintSnapshot,
      now: new Date(),
    });
    return {
      id: String(consent.id),
      customerId: input.body.customerId,
      providerCode,
      purposeCode,
      accepted: true,
      grantedAt: consent.grantedAt,
    };
  }

  listProviders() {
    return this.registry.listProviders();
  }

  getProviderHealth(providerCode?: string) {
    return this.registry.getProviderHealth(providerCode ? toProviderCode(providerCode) : undefined);
  }

  approveRequest(input: { tenantId: string; requestId: string; approvedByAdminId: string | undefined; approvalReason?: string }) {
    return this.governance.approveRequest(input);
  }

  executeExternalDataRequest(input: {
    tenantId: string;
    body: ExternalDataRequestDto;
    idempotencyKey?: string;
    requestedByUserId?: string;
    retryOfRequestId?: string;
  }) {
    return this.execution.executeExternalDataRequest(input);
  }

  previewExternalDataRequest(input: { tenantId: string; body: ExternalDataRequestDto; requestedByUserId?: string }) {
    return this.execution.previewExternalDataRequest(input);
  }

  getProviderReadiness() {
    return this.governance.getProviderReadiness();
  }

  auditExternalProvidersQuality() {
    return this.governance.auditExternalProvidersQuality();
  }

  executeSegip(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.convenience.executeSegip(input);
  }

  executeInfocenter(input: {
    tenantId: string;
    customerId: string;
    body: { documentNumber?: string; decisionStage: string; approvedByAdminId?: string; scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.convenience.executeInfocenter(input);
  }

  listCustomerConsents(input: { tenantId: string; customerId: string }) {
    return this.evidence.listCustomerConsents(input);
  }

  revokeConsent(input: { tenantId: string; consentId: string; customerId?: string }) {
    return this.evidence.revokeConsent(input);
  }

  getProviderRequest(input: { tenantId: string; requestId: string }) {
    return this.evidence.getProviderRequest(input);
  }

  getCustomerObservations(input: { tenantId: string; customerId: string; limit?: number }) {
    return this.evidence.getCustomerObservations(input);
  }

  getCustomerFeatures(input: { tenantId: string; customerId: string; limit?: number }) {
    return this.evidence.getCustomerFeatures(input);
  }

  getProviderCostPolicies(providerCode: string) {
    return this.governance.getProviderCostPolicies(providerCode);
  }

  updateProviderCostPolicy(input: {
    providerCode: string;
    queryType: string;
    patch: Parameters<ExternalDataRepository['updateCostPolicy']>[2];
  }) {
    return this.governance.updateProviderCostPolicy(input);
  }

  executeQrPayment(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.convenience.executeQrPayment(input);
  }

  executeBankTransfer(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.convenience.executeBankTransfer(input);
  }

  executeTelcoPhoneTrust(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.convenience.executeTelcoPhoneTrust(input);
  }

  executeWhatsapp(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.convenience.executeWhatsapp(input);
  }

  executeDigitalTrust(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.convenience.executeDigitalTrust(input);
  }

  createFacebookConnectUrl(input: { tenantId: string; customerId: string }) {
    return this.convenience.createFacebookConnectUrl(input);
  }

  executeFacebookCallback(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.convenience.executeFacebookCallback(input);
  }

  retryProviderRequest(input: {
    tenantId: string;
    requestId: string;
    body: Partial<ExternalDataRequestDto> & { input?: Record<string, unknown> };
    requestedByUserId?: string;
  }) {
    return this.convenience.retryProviderRequest(input);
  }

  getCustomerScoringInput(input: { tenantId: string; customerId: string }) {
    return this.evidence.getCustomerScoringInput(input);
  }

  getProviderUsage(input: { tenantId?: string; providerCode?: string; days: number }) {
    return this.governance.getProviderUsage(input);
  }

  auditIdempotencyKeys(input: { tenantId: string; days: number; limit: number }) {
    return this.governance.auditIdempotencyKeys(input);
  }

  updateProviderRuntimePolicy(input: {
    providerCode: string;
    patch: { defaultMode?: string; providerStatus?: string; isActive?: boolean; confirmProductionReady?: boolean; reason?: string };
  }) {
    return this.governance.updateProviderRuntimePolicy(input);
  }

  activateProviderKillSwitch(input: { providerCode: string; reason?: string }) {
    return this.governance.activateProviderKillSwitch(input);
  }

  getRetentionPreview(input: { days: number; limit: number }) {
    return this.governance.getRetentionPreview(input);
  }

  auditResponseSanitization(input: { limit: number }) {
    return this.governance.auditResponseSanitization(input);
  }

  getProductionGate(input: { providerCode?: string; strict: boolean }) {
    return this.governance.getProductionGate(input);
  }

  getProviderSlaReport(input: { tenantId?: string; providerCode?: string; days: number }) {
    return this.governance.getProviderSlaReport(input);
  }

  getCustomerDecisionPackage(input: { tenantId: string; customerId: string; includeRawResponses: boolean; featureMaxAgeHours?: number }) {
    return this.evidence.getCustomerDecisionPackage(input);
  }

  rebuildFeatureSnapshotFromRequest(input: { tenantId: string; requestId: string }) {
    return this.evidence.rebuildFeatureSnapshotFromRequest(input);
  }
}
