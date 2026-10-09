/**
 * @file Caso de uso: el pago inicial de una compra, avisado por el cliente y confirmado por el comercio.
 * @business El 60 % se paga directo al comercio al comprar: sólo él ve el dinero entrar, así que sólo él lo confirma.
 * @system guarda el comprobante y el estado del pago inicial en la solicitud de crédito y deja constancia en su historial.
 */
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational, assertOwnPartnerResource } from '../../../common/utils/auth/ownership.util.js';
import { CreditApplicationEventModel, CreditApplicationModel, EvidenceDocumentModel } from '../../../database/models/index.js';
import { PartnerDirectoryService } from '../../partner-onboarding/application/partner-directory.service.js';
import { PartnerProfileService } from '../../partner-onboarding/application/partner-profile.service.js';
import { ALLOWED_EVIDENCE_MIME_TYPES, type AllowedEvidenceMimeType } from '../../../common/storage/document-storage.service.js';
import { assertComprobanteNoRepetido } from '../../../common/storage/comprobante-repetido.js';
import type { DecideDownPaymentDto, SubmitDownPaymentDto } from '../credit.schemas.js';
import { expectedDownPaymentAmount } from '../domain/down-payment.js';
import { assertExpectedDownPaymentAmount } from './down-payment-amount.js';

/** Los tres estados del pago inicial (`credit.credit_applications.down_payment_status`); nulo = aún no avisó. */
export const DOWN_PAYMENT_SUBMITTED = 'submitted';
export const DOWN_PAYMENT_CONFIRMED = 'confirmed';
export const DOWN_PAYMENT_REJECTED = 'rejected';

@Injectable()
export class CreditDownPaymentService {
  private readonly logger = new Logger(CreditDownPaymentService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(CreditApplicationModel) private readonly applications: typeof CreditApplicationModel,
    @InjectModel(CreditApplicationEventModel) private readonly events: typeof CreditApplicationEventModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidences: typeof EvidenceDocumentModel,
    private readonly storage: DocumentStorageService,
    private readonly partners: PartnerProfileService,
    private readonly partnerDirectory: PartnerDirectoryService,
  ) {}

  /**
   * El cliente avisa que pagó el inicial. Esto NO lo da por pagado.
   *
   * Sólo se puede AVISAR cuando el comercio ya aceptó la venta: antes no hay a quién pagarle. Un aviso rechazado
   * se puede repetir; uno confirmado o en espera, no. El objeto subido se comprueba en el almacén antes de creer
   * sus metadatos, como en el aviso de una cuota.
   */
  async submit(input: {
    tenantId: string;
    customerId: string;
    applicationId: string;
    body: SubmitDownPaymentDto;
    currentUser: AuthenticatedUser;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const application = await this.applications.findOne({
      where: { tenantId: input.tenantId, id: input.applicationId, customerId: input.customerId },
    });
    // Una solicitud ajena es indistinguible de una inexistente: no se puede averiguar ids probándolos.
    if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');

    if (!application.partnerProfileId) {
      throw new UnprocessableEntityException(
        'APPLICATION_WITHOUT_PARTNER: esta compra no tiene comercio; el aviso no tendría quien lo confirme.',
      );
    }
    if (application.businessAcceptance !== 'accepted') {
      throw new ConflictException('DOWN_PAYMENT_NOT_ALLOWED_YET: el comercio todavía no aceptó la venta.');
    }
    if (application.downPaymentStatus === DOWN_PAYMENT_CONFIRMED) throw new ConflictException('DOWN_PAYMENT_ALREADY_CONFIRMED');
    if (application.downPaymentStatus === DOWN_PAYMENT_SUBMITTED) throw new ConflictException('DOWN_PAYMENT_ALREADY_PENDING');
    const amount = assertExpectedDownPaymentAmount(input.body.amount, application);

    const metadata = await this.storage.readObjectMetadata(input.body.storageKey);
    if (!metadata) throw new UnprocessableEntityException('EVIDENCE_OBJECT_NOT_FOUND');
    const contentType = this.assertMimeType(input.body.contentType);

    return this.sequelize.transaction(async (transaction) => {
      const now = new Date();
      await assertComprobanteNoRepetido(this.evidences, {
        tenantId: input.tenantId,
        customerId: input.customerId,
        sha256Hex: metadata.sha256Hex,
        transaction,
      });
      const evidence = await this.evidences.create(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          documentType: 'PAYMENT_PROOF',
          s3Bucket: this.storage.getBucket(),
          s3Key: input.body.storageKey,
          fileHashSha256: metadata.sha256Hex,
          mimeType: contentType,
          fileSizeBytes: String(metadata.sizeBytes),
          status: 'uploaded',
          uploadedAt: now,
          deleted: false,
          createdAtValue: now,
          updatedAtValue: now,
        } as never,
        { transaction },
      );

      const previous = application.downPaymentStatus;
      Object.assign(application, {
        downPaymentAmount: amount,
        downPaymentStatus: DOWN_PAYMENT_SUBMITTED,
        downPaymentProofEvidenceId: String(evidence.id),
        downPaymentPayerReference: input.body.payerReference ?? null,
        downPaymentSubmittedAt: now,
        // Un reintento tras un rechazo parte limpio: la decisión anterior ya no describe este aviso.
        downPaymentDecidedAt: null,
        downPaymentDecidedBy: null,
        downPaymentRejectionReason: null,
        updatedAtValue: now,
      });
      await application.save({ transaction });
      await this.recordEvent({
        application,
        eventType: 'down_payment_submitted',
        previousDownPaymentStatus: previous,
        actor: input.currentUser,
        payload: { amount },
        notes: null,
        happenedAt: now,
        transaction,
      });

      this.logger.log(`Pago inicial avisado: solicitud=${application.id} cliente=${input.customerId} importe=${amount}`);
      return this.describe(application);
    });
  }

  /** Los pagos iniciales de este comercio: por defecto sólo los que esperan su palabra. */
  async listForPartner(input: { tenantId: string; partnerProfileId: string; onlyPending: boolean; currentUser: AuthenticatedUser }) {
    const profile = await this.partners.requireProfile(input.tenantId, input.partnerProfileId);
    assertOwnPartnerResource(input.currentUser, profile.ownerMerchantUserId);

    const rows = await this.applications.findAll({
      where: {
        tenantId: input.tenantId,
        partnerProfileId: input.partnerProfileId,
        downPaymentStatus: input.onlyPending ? DOWN_PAYMENT_SUBMITTED : { [Op.ne]: null },
      },
      order: [['downPaymentSubmittedAt', 'DESC']],
      limit: 200,
    });
    const terminales = await this.partnerDirectory.terminalDirectory(input.tenantId, input.partnerProfileId);

    return {
      partnerProfileId: input.partnerProfileId,
      downPayments: rows.map((application) => {
        const local = application.posTerminalId ? terminales.get(String(application.posTerminalId)) : undefined;
        return {
          ...this.describe(application),
          applicationCode: application.applicationCode,
          currencyCode: application.currencyCode,
          branchName: local?.branchName ?? null,
          terminalAlias: local?.terminalAlias ?? null,
          payerReference: application.downPaymentPayerReference,
          hasProof: Boolean(application.downPaymentProofEvidenceId),
        };
      }),
    };
  }

  /** La imagen del comprobante, para MIRARLA antes de confirmar. Se sirven los bytes: un enlace firmado funcionaría sin sesión. */
  async readProof(input: { tenantId: string; partnerProfileId: string; applicationId: string; currentUser: AuthenticatedUser }) {
    const application = await this.requirePartnerApplication(input);
    if (!application.downPaymentProofEvidenceId) throw new NotFoundException('DOWN_PAYMENT_WITHOUT_PROOF');

    const evidence = await this.evidences.findOne({
      where: { tenantId: input.tenantId, id: application.downPaymentProofEvidenceId, deleted: false },
    });
    if (!evidence?.s3Key) throw new NotFoundException('EVIDENCE_OBJECT_NOT_FOUND');
    const bytes = await this.storage.readObject(evidence.s3Key);
    if (!bytes) throw new NotFoundException('EVIDENCE_OBJECT_NOT_FOUND');
    return { bytes, contentType: evidence.mimeType ?? 'application/octet-stream' };
  }

  /** El comercio confirma que el dinero entró, o dice por qué no. Rechazar exige motivo (lo valida el esquema). */
  async decide(input: {
    tenantId: string;
    partnerProfileId: string;
    applicationId: string;
    body: DecideDownPaymentDto;
    currentUser: AuthenticatedUser;
  }) {
    return this.sequelize.transaction(async (transaction) => {
      const application = await this.requirePartnerApplication(input, transaction);
      if (application.downPaymentStatus !== DOWN_PAYMENT_SUBMITTED) {
        throw new ConflictException(`DOWN_PAYMENT_NOT_PENDING: el pago inicial está en ${application.downPaymentStatus ?? 'sin aviso'}.`);
      }
      const now = new Date();
      const verified = input.body.verified;
      // Un aviso guardado antes de que el servidor calculara el importe (o uno manipulado en la base) no se
      // confirma a ciegas: el comercio confirma el pago inicial DE ESTA COMPRA, no un número cualquiera.
      if (verified) assertExpectedDownPaymentAmount(application.downPaymentAmount ?? '', application);
      Object.assign(application, {
        downPaymentStatus: verified ? DOWN_PAYMENT_CONFIRMED : DOWN_PAYMENT_REJECTED,
        downPaymentDecidedAt: now,
        downPaymentDecidedBy: input.currentUser.sub,
        downPaymentRejectionReason: verified ? null : (input.body.reason ?? null),
        updatedAtValue: now,
      });
      await application.save({ transaction });
      await this.recordEvent({
        application,
        eventType: verified ? 'down_payment_confirmed' : 'down_payment_rejected',
        previousDownPaymentStatus: DOWN_PAYMENT_SUBMITTED,
        actor: input.currentUser,
        payload: { verified },
        notes: input.body.reason ?? null,
        happenedAt: now,
        transaction,
      });
      this.logger.log(`Pago inicial ${verified ? 'confirmado' : 'rechazado'}: solicitud=${application.id} actor=${input.currentUser.sub}`);
      return this.describe(application);
    });
  }

  /** La solicitud, comprobando que el comercio es el dueño de la operación. */
  private async requirePartnerApplication(
    input: { tenantId: string; partnerProfileId: string; applicationId: string; currentUser: AuthenticatedUser },
    transaction?: import('sequelize').Transaction,
  ) {
    const profile = await this.partners.requireProfile(input.tenantId, input.partnerProfileId);
    assertOwnPartnerResource(input.currentUser, profile.ownerMerchantUserId);

    const application = await this.applications.findOne({
      where: { tenantId: input.tenantId, id: input.applicationId },
      ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');
    if (String(application.partnerProfileId) !== String(input.partnerProfileId)) {
      throw new ForbiddenException('La compra no nació en este comercio.');
    }
    return application;
  }

  /** Sólo los tipos que el almacén de evidencias admite: un PDF o una imagen, no cualquier cosa que alguien suba. */
  private assertMimeType(valor: string): AllowedEvidenceMimeType {
    if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(valor)) {
      throw new UnprocessableEntityException(`EVIDENCE_CONTENT_TYPE_NOT_ALLOWED: ${valor}`);
    }
    return valor as AllowedEvidenceMimeType;
  }

  private describe(application: CreditApplicationModel) {
    return {
      applicationId: String(application.id),
      downPaymentStatus: application.downPaymentStatus,
      downPaymentAmount: application.downPaymentAmount,
      expectedDownPaymentAmount: expectedDownPaymentAmount(application.requestedAmount),
      submittedAt: application.downPaymentSubmittedAt?.toISOString() ?? null,
      decidedAt: application.downPaymentDecidedAt?.toISOString() ?? null,
      rejectionReason: application.downPaymentRejectionReason,
    };
  }

  private recordEvent(input: {
    application: CreditApplicationModel;
    eventType: string;
    previousDownPaymentStatus: string | null;
    actor: AuthenticatedUser;
    payload: Record<string, unknown>;
    notes: string | null;
    happenedAt: Date;
    transaction: import('sequelize').Transaction;
  }) {
    const { application, actor, happenedAt } = input;
    return this.events.create(
      {
        tenantId: application.tenantId,
        creditApplicationId: String(application.id),
        eventType: input.eventType,
        previousStatus: application.status,
        newStatus: application.status,
        actorType: actor.role,
        actorInternalUserId: actor.internalUserId ?? null,
        reasonCode: null,
        payloadJson: { ...input.payload, previousDownPaymentStatus: input.previousDownPaymentStatus },
        notes: input.notes,
        happenedAt,
        createdAtValue: happenedAt,
      } as never,
      { transaction: input.transaction },
    );
  }
}
