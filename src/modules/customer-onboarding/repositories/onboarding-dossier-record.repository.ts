/**
 * @file Puerto de persistencia: lo que el alta declaró y verificó de un cliente.
 * @business El analista del caso de identidad tiene que ver todo lo que Atlas guardó del alta, en un solo sitio.
 * @system sólo lectura, acotada por inquilino y cliente: flujo, documento, contactos, intentos de identidad, extracto, evidencias y alcance de la agenda.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  BankStatementReviewModel,
  CustomerContactMethodModel,
  CustomerIdentityDocumentModel,
  EvidenceDocumentModel,
  IdentityVerificationAttemptModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
} from '../../../database/models/index.js';
import { IDENTITY_ATTEMPT_LOOKBACK_LIMIT } from '../../../common/utils/identity/identity-result.util.js';

@Injectable()
export class OnboardingDossierRecordRepository {
  constructor(
    @InjectModel(OnboardingFlowModel) private readonly flows: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel) private readonly stepEvents: typeof OnboardingStepEventModel,
    @InjectModel(CustomerIdentityDocumentModel) private readonly documents: typeof CustomerIdentityDocumentModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactMethods: typeof CustomerContactMethodModel,
    @InjectModel(IdentityVerificationAttemptModel) private readonly attempts: typeof IdentityVerificationAttemptModel,
    @InjectModel(BankStatementReviewModel) private readonly statements: typeof BankStatementReviewModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidence: typeof EvidenceDocumentModel,
  ) {}

  findLatestFlow(tenantId: string, customerId: string): Promise<OnboardingFlowModel | null> {
    return this.flows.findOne({ where: { tenantId, customerId }, order: [['id', 'DESC']] } as FindOptions);
  }

  findCurrentIdentityDocument(tenantId: string, customerId: string): Promise<CustomerIdentityDocumentModel | null> {
    return this.documents.findOne({ where: { tenantId, customerId, validUntil: null }, order: [['id', 'DESC']] } as FindOptions);
  }

  findContactMethods(tenantId: string, customerId: string): Promise<CustomerContactMethodModel[]> {
    return this.contactMethods.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [
        ['isPrimary', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  /** Los intentos recientes de los DOS canales, del más nuevo al más viejo. */
  findRecentAttempts(tenantId: string, customerId: string): Promise<IdentityVerificationAttemptModel[]> {
    return this.attempts.findAll({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      limit: IDENTITY_ATTEMPT_LOOKBACK_LIMIT,
    } as FindOptions);
  }

  findLatestBankStatement(tenantId: string, customerId: string): Promise<BankStatementReviewModel | null> {
    return this.statements.findOne({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [['id', 'DESC']],
    } as FindOptions);
  }

  /** El alcance del último volcado de la agenda (`all` | `limited` en iOS 18), si lo hubo. */
  async findAddressBookScope(tenantId: string, customerId: string): Promise<string | null> {
    const flows = await this.flows.findAll({ where: { tenantId, customerId }, attributes: ['id'] } as FindOptions);
    if (flows.length === 0) return null;
    const evento = await this.stepEvents.findOne({
      where: { tenantId, onboardingFlowId: { [Op.in]: flows.map((flow) => String(flow.id)) }, stepCode: 'address_book_synced' },
      order: [['id', 'DESC']],
    } as FindOptions);
    const alcance = (evento?.payloadJson as { accessScope?: unknown } | null | undefined)?.accessScope;
    return typeof alcance === 'string' ? alcance : null;
  }

  findEvidence(tenantId: string, customerId: string): Promise<EvidenceDocumentModel[]> {
    return this.evidence.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      attributes: ['id', 'documentType', 'uploadedAt'],
      order: [['id', 'ASC']],
    } as FindOptions);
  }
}
