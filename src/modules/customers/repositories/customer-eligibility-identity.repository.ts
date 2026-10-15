/**
 * @file Puerto de persistencia: hechos de identidad y evidencia que alimentan la habilitación.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system lectura sin escrituras: documento de identidad, intento de verificación vigente y revisiones de evidencia pendientes.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  CustomerIdentityDocumentModel,
  EvidenceDocumentModel,
  EvidenceReviewModel,
  IdentityVerificationAttemptModel,
} from '../../../database/models/index.js';
import { IDENTITY_ATTEMPT_LOOKBACK_LIMIT, pickIdentityAttemptForEligibility } from '../../../common/utils/identity/identity-result.util.js';
import { identityRequiresHumanReview } from '../../../config/decision-engine-auto-apply.js';
import type { EligibilityReadOptions } from './customer-eligibility.read-options.js';

@Injectable()
export class CustomerEligibilityIdentityRepository {
  constructor(
    @InjectModel(CustomerIdentityDocumentModel) private readonly identityDocumentModel: typeof CustomerIdentityDocumentModel,
    @InjectModel(IdentityVerificationAttemptModel) private readonly identityAttemptModel: typeof IdentityVerificationAttemptModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidenceModel: typeof EvidenceDocumentModel,
    @InjectModel(EvidenceReviewModel) private readonly evidenceReviewModel: typeof EvidenceReviewModel,
  ) {}

  findLatestIdentityDocument(
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

  /** El intento VIGENTE, no el último a secas: uno posterior sin resolver no tapa un `verified` (I-2, ver `pickCurrentIdentityAttempt`). */
  async findCurrentIdentityResult(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<string | null> {
    const attempts = await this.identityAttemptModel.findAll({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      limit: IDENTITY_ATTEMPT_LOOKBACK_LIMIT,
      transaction: options.transaction,
    } as FindOptions);
    return pickIdentityAttemptForEligibility(attempts, { requireHumanReview: identityRequiresHumanReview() })?.finalResult ?? null;
  }

  /**
   * Revisiones de evidencia sin resolver. `evidence_reviews` no referencia al cliente: cuelga del
   * documento. Se resuelve con dos consultas explícitas en vez de un JOIN implícito.
   */
  async countPendingEvidenceReviews(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<number> {
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
}
