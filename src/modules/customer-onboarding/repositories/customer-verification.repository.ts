/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, literal, Op, Transaction } from 'sequelize';
import {
  CustomerIdentityDocumentModel,
  EvidenceDocumentModel,
  EvidenceReviewModel,
  IdentityVerificationAttemptModel,
  WatchlistEntryModel,
  WatchlistMatchModel,
} from '../../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/**
 * Lecturas y escrituras de la resolución de identidad y del screening de cumplimiento.
 *
 * Estas dos cosas eran el techo del flujo: `identity_verification_attempts.final_result` se creaba
 * siempre en `pending_review` y `evidence_reviews` en `pending_review`, sin ningún camino para
 * resolverlas — de modo que las condiciones C9 y C10 de la regla de habilitación no podían
 * cumplirse nunca. `watchlist_entries` estaba migrada y jamás se consultaba (C13).
 */
@Injectable()
export class CustomerVerificationRepository {
  constructor(
    @InjectModel(IdentityVerificationAttemptModel) private readonly attemptModel: typeof IdentityVerificationAttemptModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidenceModel: typeof EvidenceDocumentModel,
    @InjectModel(EvidenceReviewModel) private readonly reviewModel: typeof EvidenceReviewModel,
    @InjectModel(CustomerIdentityDocumentModel) private readonly identityDocumentModel: typeof CustomerIdentityDocumentModel,
    @InjectModel(WatchlistEntryModel) private readonly watchlistEntryModel: typeof WatchlistEntryModel,
    @InjectModel(WatchlistMatchModel) private readonly watchlistMatchModel: typeof WatchlistMatchModel,
  ) {}

  /**
   * El intento que origino una ejecucion del motor.
   *
   * Es lo unico que ata las dos bases: el motor conoce su `executionId` pero no sabe de que cliente
   * es —a proposito, no tiene por que—, y aqui el intento guarda ese identificador entre sus
   * codigos de motivo. Sin esta busqueda, cuando el analista resuelve la revision no hay forma de
   * saber a quien aplicarsela.
   */
  findAttemptByExecutionId(
    tenantId: string,
    executionId: string,
    options: RepositoryOptions = {},
  ): Promise<IdentityVerificationAttemptModel | null> {
    return this.attemptModel.findOne({
      where: {
        tenantId,
        [Op.and]: [literal(`reason_codes_json->>'executionId' = ${this.attemptModel.sequelize!.escape(executionId)}`)],
      },
      order: [['id', 'DESC']],
      transaction: options.transaction,
    });
  }

  findLatestAttempt(
    tenantId: string,
    customerId: string,
    options: RepositoryOptions = {},
  ): Promise<IdentityVerificationAttemptModel | null> {
    return this.attemptModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  async resolveAttempt(
    attempt: IdentityVerificationAttemptModel,
    values: { finalResult: string; reviewedBy: string | null; notes: string | null; now: Date },
    options: RepositoryOptions,
  ): Promise<IdentityVerificationAttemptModel> {
    attempt.finalResult = values.finalResult;
    attempt.completedAt = values.now;
    attempt.manualReviewedBy = values.reviewedBy;
    attempt.manualReviewNotes = values.notes;
    return attempt.save({ transaction: options.transaction });
  }

  findLatestIdentityDocument(
    tenantId: string,
    customerId: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerIdentityDocumentModel | null> {
    return this.identityDocumentModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  async resolveIdentityDocument(
    tenantId: string,
    customerId: string,
    values: { verificationStatus: string; now: Date },
    options: RepositoryOptions,
  ): Promise<void> {
    const document = await this.identityDocumentModel.findOne({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      transaction: options.transaction,
    } as FindOptions);
    if (!document) return;
    document.verificationStatus = values.verificationStatus;
    document.verifiedAt = values.verificationStatus === 'verified' ? values.now : null;
    await document.save({ transaction: options.transaction });
  }

  /** De que cliente es un intento de verificacion. Lo usa la pantalla del analista del motor. */
  async findCustomerIdByAttempt(tenantId: string, attemptId: string): Promise<string | null> {
    const attempt = await this.attemptModel.findOne({
      where: { tenantId, id: attemptId },
      attributes: ['customerId'],
    } as FindOptions);
    return attempt?.customerId ? String(attempt.customerId) : null;
  }

  /**
   * Los documentos de identidad que subio el cliente.
   *
   * Los usa el analista para VER el carnet y la selfie con las que tiene que decidir: la revision
   * manual ocurre en el motor, que solo recibe el hash de las imagenes, asi que sin esto la decision
   * humana se toma sin mirar nada.
   */
  async findEvidenceDocuments(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<EvidenceDocumentModel[]> {
    return this.evidenceModel.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [['id', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  /** Revisiones de evidencia sin resolver del cliente. Se resuelven en bloque con la identidad. */
  async findPendingReviews(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<EvidenceReviewModel[]> {
    const documents = await this.evidenceModel.findAll({
      where: { tenantId, customerId },
      attributes: ['id'],
      transaction: options.transaction,
    } as FindOptions);
    const documentIds = documents.map((row) => String(row.id));
    if (documentIds.length === 0) return [];
    return this.reviewModel.findAll({
      where: { tenantId, evidenceDocumentId: { [Op.in]: documentIds }, reviewStatus: { [Op.notIn]: ['approved', 'accepted'] } },
      transaction: options.transaction,
    } as FindOptions);
  }

  async resolveReview(
    review: EvidenceReviewModel,
    values: { reviewStatus: string; reviewedBy: string | null; rejectionReasonCode: string | null; notes: string | null; now: Date },
    options: RepositoryOptions,
  ): Promise<void> {
    review.reviewStatus = values.reviewStatus;
    review.reviewedBy = values.reviewedBy;
    review.rejectionReasonCode = values.rejectionReasonCode;
    review.notes = values.notes;
    review.reviewedAt = values.now;
    await review.save({ transaction: options.transaction });
  }

  /**
   * Entradas de lista restrictiva vigentes que coinciden con alguno de los hashes buscados.
   *
   * El cotejo es por HASH, nunca por el valor en claro: la lista guarda `entity_hash` y el sistema
   * calcula el hash del dato del cliente. Así el screening funciona sin que ninguna de las dos
   * partes exponga el documento o el nombre.
   */
  findActiveEntriesByHashes(tenantId: string, hashes: readonly string[], now: Date): Promise<WatchlistEntryModel[]> {
    if (hashes.length === 0) return Promise.resolve([]);
    return this.watchlistEntryModel.findAll({
      where: {
        entityHash: { [Op.in]: [...hashes] },
        deleted: { [Op.ne]: true },
        status: 'active',
        // Las listas globales (`_tenant_id` nulo) aplican a todos los tenants.
        [Op.and]: [{ [Op.or]: [{ tenantId: null }, { tenantId }] }, { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }] }],
      },
    } as FindOptions);
  }

  findMatches(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<WatchlistMatchModel[]> {
    return this.watchlistMatchModel.findAll({
      where: { tenantId, customerId },
      transaction: options.transaction,
    } as FindOptions);
  }

  createMatch(
    values: {
      tenantId: string;
      watchlistEntryId: string;
      customerId: string;
      matchedEntityType: string;
      matchedValueHash: string;
      matchMethod: string;
      matchConfidence: string;
      matchedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<WatchlistMatchModel> {
    return this.watchlistMatchModel.create(
      { ...values, sessionId: null, deviceId: null, openedReviewCaseId: null, openedFraudCaseId: null, createdAtValue: values.matchedAt },
      { transaction: options.transaction },
    );
  }

  async clearMatch(match: WatchlistMatchModel, options: RepositoryOptions): Promise<void> {
    await match.destroy({ transaction: options.transaction });
  }
}
