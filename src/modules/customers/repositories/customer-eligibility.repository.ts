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
  DataQualityIssueModel,
  EvidenceDocumentModel,
  EvidenceReviewModel,
  FraudCaseModel,
  IdentityVerificationAttemptModel,
  ManualReviewCaseModel,
  OnboardingFlowModel,
  RiskAssessmentResultModel,
  WatchlistMatchModel,
} from '../../../database/models/index.js';

/** Fotografía de todo lo que la regla de habilitación necesita, leída en una sola pasada. */
export type EligibilityFacts = {
  hasCredentials: boolean;
  verifiedContactCount: number;
  profile: CustomerProfileVersionModel | null;
  presentFinancialAttributeCodes: string[];
  hasCurrentAddress: boolean;
  referenceContactCount: number;
  identityDocument: CustomerIdentityDocumentModel | null;
  identityVerificationResult: string | null;
  pendingEvidenceReviewCount: number;
  grantedConsentDocumentIds: string[];
  requiredConsentDocumentIds: string[];
  openObservationCount: number;
  unclearedWatchlistMatchCount: number;
  latestRisk: RiskAssessmentResultModel | null;
  openFraudCaseCount: number;
};

const OPEN_CASE_STATUSES = ['open', 'in_review', 'pending', 'escalated'];

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
    @InjectModel(DataQualityIssueModel) private readonly issueModel: typeof DataQualityIssueModel,
    @InjectModel(ManualReviewCaseModel) private readonly reviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(WatchlistMatchModel) private readonly watchlistMatchModel: typeof WatchlistMatchModel,
    @InjectModel(RiskAssessmentResultModel) private readonly riskResultModel: typeof RiskAssessmentResultModel,
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
    @InjectModel(OnboardingFlowModel) private readonly onboardingFlowModel: typeof OnboardingFlowModel,
  ) {}

  async loadFacts(tenantId: string, customerId: string): Promise<EligibilityFacts> {
    const [
      hasCredentials,
      verifiedContactCount,
      profile,
      presentFinancialAttributeCodes,
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
      this.hasCredentials(customerId),
      this.countVerifiedContacts(tenantId, customerId),
      this.findCurrentProfile(tenantId, customerId),
      this.findPresentFinancialAttributeCodes(tenantId, customerId),
      this.hasCurrentAddress(tenantId, customerId),
      this.countReferenceContacts(tenantId, customerId),
      this.findLatestIdentityDocument(tenantId, customerId),
      this.findLatestIdentityVerificationResult(tenantId, customerId),
      this.countPendingEvidenceReviews(tenantId, customerId),
      this.findGrantedConsentDocumentIds(tenantId, customerId),
      this.findRequiredConsentDocumentIds(tenantId),
      this.countOpenObservations(tenantId, customerId),
      this.countUnclearedWatchlistMatches(tenantId, customerId),
      this.findLatestRiskResult(tenantId, customerId),
      this.countOpenFraudCases(tenantId, customerId),
    ]);

    return {
      hasCredentials,
      verifiedContactCount,
      profile,
      presentFinancialAttributeCodes,
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

  private async hasCredentials(customerId: string): Promise<boolean> {
    const count = await this.credentialModel.count({ where: { actorType: 'customer', actorId: customerId, deleted: false } });
    return count > 0;
  }

  private countVerifiedContacts(tenantId: string, customerId: string): Promise<number> {
    return this.contactModel.count({ where: { tenantId, customerId, status: 'verified', deleted: { [Op.ne]: true } } });
  }

  private findCurrentProfile(tenantId: string, customerId: string): Promise<CustomerProfileVersionModel | null> {
    return this.profileModel.findOne({
      where: { tenantId, customerId, validUntil: null },
      order: [
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  /** Códigos económicos con un valor vigente. Resuelve la definición por código, no por id. */
  private async findPresentFinancialAttributeCodes(tenantId: string, customerId: string): Promise<string[]> {
    const values = await this.attributeValueModel.findAll({
      where: { tenantId, customerId, validUntil: null },
      attributes: ['attributeDefinitionId'],
    } as FindOptions);
    const definitionIds = values.map((row) => String(row.attributeDefinitionId)).filter((id) => id !== 'null');
    if (definitionIds.length === 0) return [];

    const definitions = await this.attributeDefinitionModel.findAll({
      where: { id: { [Op.in]: definitionIds } },
      attributes: ['id', 'attributeCode'],
    } as FindOptions);
    return definitions.map((row) => row.attributeCode).filter((code): code is string => code !== null);
  }

  private async hasCurrentAddress(tenantId: string, customerId: string): Promise<boolean> {
    const count = await this.addressModel.count({
      where: { tenantId, customerId, currentVersionId: { [Op.ne]: null }, deleted: { [Op.ne]: true } },
    });
    return count > 0;
  }

  private countReferenceContacts(tenantId: string, customerId: string): Promise<number> {
    return this.referenceModel.count({ where: { tenantId, customerId, deleted: { [Op.ne]: true } } });
  }

  private findLatestIdentityDocument(tenantId: string, customerId: string): Promise<CustomerIdentityDocumentModel | null> {
    return this.identityDocumentModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
    } as FindOptions);
  }

  private async findLatestIdentityVerificationResult(tenantId: string, customerId: string): Promise<string | null> {
    const attempt = await this.identityAttemptModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
    } as FindOptions);
    return attempt?.finalResult ?? null;
  }

  /**
   * Revisiones de evidencia sin resolver. `evidence_reviews` no referencia al cliente: cuelga del
   * documento. Se resuelve con dos consultas explícitas en vez de un JOIN implícito.
   */
  private async countPendingEvidenceReviews(tenantId: string, customerId: string): Promise<number> {
    const documents = await this.evidenceModel.findAll({ where: { tenantId, customerId }, attributes: ['id'] } as FindOptions);
    const documentIds = documents.map((row) => String(row.id));
    if (documentIds.length === 0) return 0;
    return this.evidenceReviewModel.count({
      where: { tenantId, evidenceDocumentId: { [Op.in]: documentIds }, reviewStatus: { [Op.notIn]: ['approved', 'accepted'] } },
    });
  }

  private async findGrantedConsentDocumentIds(tenantId: string, customerId: string): Promise<string[]> {
    const rows = await this.consentModel.findAll({
      where: { tenantId, customerId, granted: true, revokedAt: null },
      attributes: ['consentDocumentId'],
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
  async findRequiredConsentDocumentIds(tenantId: string): Promise<string[]> {
    const rows = await this.consentDocumentModel.findAll({
      where: { tenantId, status: 'published', requiresExplicitAction: true },
      attributes: ['id'],
    } as FindOptions);
    return rows.map((row) => String(row.id));
  }

  private countOpenObservations(tenantId: string, customerId: string): Promise<number> {
    return this.issueModel.count({
      where: { tenantId, targetRecordId: customerId, resolvedAt: null, issueStatus: { [Op.notIn]: ['resolved', 'dismissed'] } },
    });
  }

  private countUnclearedWatchlistMatches(tenantId: string, customerId: string): Promise<number> {
    return this.watchlistMatchModel.count({ where: { tenantId, customerId } });
  }

  private findLatestRiskResult(tenantId: string, customerId: string): Promise<RiskAssessmentResultModel | null> {
    return this.riskResultModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
    } as FindOptions);
  }

  private countOpenFraudCases(tenantId: string, customerId: string): Promise<number> {
    return this.fraudCaseModel.count({
      where: { tenantId, customerId, closedAt: null, caseStatus: { [Op.in]: OPEN_CASE_STATUSES }, deleted: { [Op.ne]: true } },
    });
  }

  /** Casos de revisión manual sin cerrar, usados por el endpoint de observaciones del cliente. */
  findOpenReviewCases(tenantId: string, customerId: string): Promise<ManualReviewCaseModel[]> {
    return this.reviewCaseModel.findAll({
      where: { tenantId, customerId, closedAt: null, deleted: { [Op.ne]: true } },
      order: [['id', 'DESC']],
      limit: 50,
    } as FindOptions);
  }

  /** Incidencias de calidad de datos abiertas del cliente, para la pantalla de observaciones. */
  findOpenIssues(tenantId: string, customerId: string): Promise<DataQualityIssueModel[]> {
    return this.issueModel.findAll({
      where: { tenantId, targetRecordId: customerId, resolvedAt: null, issueStatus: { [Op.notIn]: ['resolved', 'dismissed'] } },
      order: [['id', 'DESC']],
      limit: 50,
    } as FindOptions);
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
