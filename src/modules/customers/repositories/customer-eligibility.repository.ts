/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  AttributeDefinitionModel,
  AuthCredentialModel,
  ConsentDocumentModel,
  CustomerAddressModel,
  CustomerAttributeValueModel,
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerIdentityDocumentModel,
  CustomerProfileVersionModel,
  CustomerReferenceContactModel,
  EvidenceDocumentModel,
  EvidenceReviewModel,
  IdentityVerificationAttemptModel,
  OnboardingFlowModel,
} from '../../../database/models/index.js';
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
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactModel: typeof CustomerContactMethodModel,
    @InjectModel(CustomerProfileVersionModel) private readonly profileModel: typeof CustomerProfileVersionModel,
    @InjectModel(CustomerAttributeValueModel) private readonly attributeValueModel: typeof CustomerAttributeValueModel,
    @InjectModel(AttributeDefinitionModel) private readonly attributeDefinitionModel: typeof AttributeDefinitionModel,
    @InjectModel(CustomerAddressModel) private readonly addressModel: typeof CustomerAddressModel,
    @InjectModel(CustomerReferenceContactModel) private readonly referenceModel: typeof CustomerReferenceContactModel,
    @InjectModel(CustomerIdentityDocumentModel) private readonly identityDocumentModel: typeof CustomerIdentityDocumentModel,
    @InjectModel(IdentityVerificationAttemptModel) private readonly identityAttemptModel: typeof IdentityVerificationAttemptModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidenceModel: typeof EvidenceDocumentModel,
    @InjectModel(EvidenceReviewModel) private readonly evidenceReviewModel: typeof EvidenceReviewModel,
    @InjectModel(CustomerConsentModel) private readonly consentModel: typeof CustomerConsentModel,
    @InjectModel(ConsentDocumentModel) private readonly consentDocumentModel: typeof ConsentDocumentModel,
    @InjectModel(OnboardingFlowModel) private readonly onboardingFlowModel: typeof OnboardingFlowModel,
    // Cumplimiento y riesgo: qué encontró el banco sobre el cliente, frente a qué completó él.
    private readonly riskRepository: CustomerEligibilityRiskRepository,
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
    ] = await Promise.all([
      this.hasCredentials(customerId, options),
      this.countVerifiedContacts(tenantId, customerId, options),
      this.findCurrentProfile(tenantId, customerId, options),
      this.findFinancialAttributes(tenantId, customerId, options),
      this.hasCurrentAddress(tenantId, customerId, options),
      this.countReferenceContacts(tenantId, customerId, options),
      this.findLatestIdentityDocument(tenantId, customerId, options),
      this.findLatestIdentityVerificationResult(tenantId, customerId, options),
      this.countPendingEvidenceReviews(tenantId, customerId, options),
      this.findGrantedConsentDocumentIds(tenantId, customerId, options),
      this.findRequiredConsentDocumentIds(tenantId, options),
      this.riskRepository.countOpenObservations(tenantId, customerId, options),
      this.riskRepository.countUnclearedWatchlistMatches(tenantId, customerId, options),
      this.riskRepository.findLatestRiskResult(tenantId, customerId, options),
      this.riskRepository.countOpenFraudCases(tenantId, customerId, options),
    ]);

    return {
      hasCredentials,
      verifiedContactCount,
      profile,
      presentFinancialAttributeCodes: financialAttributes.codes,
      financialAttributeValues: financialAttributes.values,
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
    };
  }

  private async hasCredentials(customerId: string, options: EligibilityReadOptions): Promise<boolean> {
    const count = await this.credentialModel.count({
      where: { actorType: 'customer', actorId: customerId, deleted: false },
      transaction: options.transaction,
    });
    return count > 0;
  }

  private countVerifiedContacts(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<number> {
    return this.contactModel.count({
      where: { tenantId, customerId, status: 'verified', deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    });
  }

  private findCurrentProfile(
    tenantId: string,
    customerId: string,
    options: EligibilityReadOptions,
  ): Promise<CustomerProfileVersionModel | null> {
    return this.profileModel.findOne({
      where: { tenantId, customerId, validUntil: null },
      order: [
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  /**
   * Atributos económicos vigentes: qué códigos hay y, para los numéricos, su valor.
   *
   * Devuelve ambas cosas de una sola pasada porque salen de la misma consulta: la completitud
   * (condición C5) mira los códigos y la elegibilidad por producto mira los valores. Separarlas
   * duplicaría el par de consultas sin ganar nada.
   */
  private async findFinancialAttributes(
    tenantId: string,
    customerId: string,
    options: EligibilityReadOptions,
  ): Promise<{ codes: string[]; values: Record<string, number> }> {
    const rows = await this.attributeValueModel.findAll({
      where: { tenantId, customerId, validUntil: null },
      attributes: ['attributeDefinitionId', 'valueNumber'],
      transaction: options.transaction,
    } as FindOptions);
    const definitionIds = rows.map((row) => String(row.attributeDefinitionId)).filter((id) => id !== 'null');
    if (definitionIds.length === 0) return { codes: [], values: {} };

    const definitions = await this.attributeDefinitionModel.findAll({
      where: { id: { [Op.in]: definitionIds } },
      attributes: ['id', 'attributeCode'],
      transaction: options.transaction,
    } as FindOptions);
    const codeByDefinitionId = new Map(definitions.map((row) => [String(row.id), row.attributeCode]));

    const codes: string[] = [];
    const values: Record<string, number> = {};
    for (const row of rows) {
      const code = codeByDefinitionId.get(String(row.attributeDefinitionId));
      if (!code) continue;
      codes.push(code);
      const numeric = row.valueNumber === null ? Number.NaN : Number(row.valueNumber);
      if (Number.isFinite(numeric)) values[code] = numeric;
    }
    return { codes, values };
  }

  private async hasCurrentAddress(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<boolean> {
    const count = await this.addressModel.count({
      where: { tenantId, customerId, currentVersionId: { [Op.ne]: null }, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    });
    return count > 0;
  }

  private countReferenceContacts(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<number> {
    return this.referenceModel.count({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    });
  }

  private findLatestIdentityDocument(
    tenantId: string,
    customerId: string,
    options: EligibilityReadOptions,
  ): Promise<CustomerIdentityDocumentModel | null> {
    return this.identityDocumentModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  private async findLatestIdentityVerificationResult(
    tenantId: string,
    customerId: string,
    options: EligibilityReadOptions,
  ): Promise<string | null> {
    const attempt = await this.identityAttemptModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      transaction: options.transaction,
    } as FindOptions);
    return attempt?.finalResult ?? null;
  }

  /**
   * Revisiones de evidencia sin resolver. `evidence_reviews` no referencia al cliente: cuelga del
   * documento. Se resuelve con dos consultas explícitas en vez de un JOIN implícito.
   */
  private async countPendingEvidenceReviews(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<number> {
    const documents = await this.evidenceModel.findAll({
      where: { tenantId, customerId },
      attributes: ['id'],
      transaction: options.transaction,
    } as FindOptions);
    const documentIds = documents.map((row) => String(row.id));
    if (documentIds.length === 0) return 0;
    return this.evidenceReviewModel.count({
      where: { tenantId, evidenceDocumentId: { [Op.in]: documentIds }, reviewStatus: { [Op.notIn]: ['approved', 'accepted'] } },
      transaction: options.transaction,
    });
  }

  private async findGrantedConsentDocumentIds(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<string[]> {
    const rows = await this.consentModel.findAll({
      where: { tenantId, customerId, granted: true, revokedAt: null },
      attributes: ['consentDocumentId'],
      transaction: options.transaction,
    } as FindOptions);
    return rows.map((row) => String(row.consentDocumentId)).filter((id) => id !== 'null');
  }

  /**
   * Documentos legales obligatorios del tenant.
   *
   * Se usa la columna ya existente `consent_documents.requires_explicit_action` como marca de
   * obligatoriedad, en vez de inventar una tabla de configuración paralela: es exactamente la
   * semántica que la columna declara y evita dos fuentes de verdad sobre qué hay que aceptar.
   */
  async findRequiredConsentDocumentIds(tenantId: string, options: EligibilityReadOptions = {}): Promise<string[]> {
    const rows = await this.consentDocumentModel.findAll({
      where: { tenantId, status: 'published', requiresExplicitAction: true },
      attributes: ['id'],
      transaction: options.transaction,
    } as FindOptions);
    return rows.map((row) => String(row.id));
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
