/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { OnboardingFlowModel } from '../../../database/models/index.js';
import { CustomerEligibilityConsentsRepository } from './customer-eligibility-consents.repository.js';
import { CustomerEligibilityIdentityRepository } from './customer-eligibility-identity.repository.js';
import { CustomerEligibilityPhasesRepository } from './customer-eligibility-phases.repository.js';
import { CustomerEligibilityProfileRepository } from './customer-eligibility-profile.repository.js';
import { CustomerEligibilityRiskRepository } from './customer-eligibility-risk.repository.js';
import type { EligibilityFacts } from './customer-eligibility.facts.js';
import type { EligibilityReadOptions } from './customer-eligibility.read-options.js';

export type { EligibilityReadOptions } from './customer-eligibility.read-options.js';

/**
 * Lecturas de la regla de habilitación.
 *
 * Todas las consultas van en paralelo desde el servicio: son independientes entre sí y ninguna
 * escribe, así que el costo real es el de la más lenta y no la suma. Se evita deliberadamente el
 * uso de asociaciones Sequelize (el proyecto no las declara) y se resuelven las dos relaciones
 * indirectas —evidencia y consentimientos obligatorios— con dos consultas encadenadas explícitas.
 */
@Injectable()
export class CustomerEligibilityRepository {
  constructor(
    @InjectModel(OnboardingFlowModel) private readonly onboardingFlowModel: typeof OnboardingFlowModel,
    // Lo que el cliente declaró y completó: cuenta y datos, identidad y evidencia, consentimientos.
    private readonly profileRepository: CustomerEligibilityProfileRepository,
    private readonly identityRepository: CustomerEligibilityIdentityRepository,
    private readonly consentsRepository: CustomerEligibilityConsentsRepository,
    // Cumplimiento y riesgo: qué encontró el banco sobre el cliente, frente a qué completó él.
    private readonly riskRepository: CustomerEligibilityRiskRepository,
    // Las fases nuevas del alta (permisos del teléfono y encuesta de hábitos): sus lecturas viven aparte.
    private readonly phasesRepository: CustomerEligibilityPhasesRepository,
  ) {}

  async loadFacts(tenantId: string, customerId: string, options: EligibilityReadOptions = {}): Promise<EligibilityFacts> {
    const [
      hasCredentials,
      verifiedContactCount,
      profile,
      financialAttributes,
      hasCurrentAddress,
      referenceContactCount,
      identityDocument,
      identityVerificationResult,
      pendingEvidenceReviewCount,
      consents,
      requiredConsentDocumentIds,
      openObservationCount,
      unclearedWatchlistMatchCount,
      latestRisk,
      openFraudCaseCount,
      decidedDevicePermissionPurposes,
      answeredSurveyQuestionCodes,
    ] = await Promise.all([
      this.profileRepository.hasCredentials(customerId, options),
      this.profileRepository.countVerifiedContacts(tenantId, customerId, options),
      this.profileRepository.findCurrentProfile(tenantId, customerId, options),
      this.profileRepository.findFinancialAttributes(tenantId, customerId, options),
      this.profileRepository.hasCurrentAddress(tenantId, customerId, options),
      this.profileRepository.countReferenceContacts(tenantId, customerId, options),
      this.identityRepository.findLatestIdentityDocument(tenantId, customerId, options),
      this.identityRepository.findCurrentIdentityResult(tenantId, customerId, options),
      this.identityRepository.countPendingEvidenceReviews(tenantId, customerId, options),
      this.consentsRepository.findGrantedConsentDocumentIds(tenantId, customerId, options),
      this.consentsRepository.findRequiredConsentDocumentIds(tenantId, options),
      this.riskRepository.countOpenObservations(tenantId, customerId, options),
      this.riskRepository.countUnclearedWatchlistMatches(tenantId, customerId, options),
      this.riskRepository.findLatestRiskResult(tenantId, customerId, options),
      this.riskRepository.countOpenFraudCases(tenantId, customerId, options),
      this.phasesRepository.findDecidedDevicePermissionPurposes(tenantId, customerId, options),
      this.phasesRepository.findAnsweredSurveyQuestionCodes(tenantId, customerId, options),
    ]);

    return {
      hasCredentials,
      verifiedContactCount,
      profile,
      presentFinancialAttributeCodes: financialAttributes.codes,
      financialAttributeValues: financialAttributes.values,
      financialAttributeTexts: financialAttributes.texts,
      hasCurrentAddress,
      referenceContactCount,
      identityDocument,
      identityVerificationResult,
      pendingEvidenceReviewCount,
      grantedConsentDocumentIds: consents,
      requiredConsentDocumentIds,
      openObservationCount,
      unclearedWatchlistMatchCount,
      latestRisk,
      openFraudCaseCount,
      decidedDevicePermissionPurposes,
      answeredSurveyQuestionCodes,
    };
  }

  /**
   * Flujo de onboarding vigente. Vive aquí —y no en el módulo de onboarding— para que la respuesta
   * de `GET /customers/:customerId/me` pueda incluirlo sin invertir la dependencia entre módulos.
   */
  findLatestOnboardingFlow(tenantId: string, customerId: string): Promise<OnboardingFlowModel | null> {
    return this.onboardingFlowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }
}
