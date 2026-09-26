/**
 * @file Caso de uso: lo que el COMERCIO hace con los avisos de pago que recibe.
 * @business El dinero de una transferencia lo ve el comercio en su cuenta, no Atlas: por eso lo confirma él.
 * @system resuelve la cola de avisos, sirve el comprobante y, al verificarse, registra el pago real.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { EvidenceDocumentModel, LoanPaymentClaimModel } from '../../database/models/index.js';

import { LoanPaymentService } from '../loans/application/loan-payment.service.js';
import { PartnerProfileService } from '../partner-onboarding/application/partner-profile.service.js';
import { EventsService } from '../events/events.service.js';
import { assertOwnPartnerResource } from '../../common/utils/auth/ownership.util.js';
import type { DecidePaymentClaimDto } from './loan-payment-claims.schemas.js';
import { INSTALLMENT_AGGREGATE, nextInstallmentVersion, PaymentClaimsContextService, PENDIENTE } from './payment-claims.shared.js';

/**
 * El lado del COMERCIO, separado del lado del cliente.
 *
 * `LoanPaymentClaimsService` llegó a 752 líneas —dos veces y media el límite de
 * `check:file-size`— siendo en realidad dos casos de uso que sólo comparten una tabla: el cliente
 * avisa de que pagó, y el comercio lo confirma mirando su cuenta. El corte no es arbitrario: es
 * exactamente el que ya marcaban los dos controladores, que no compartían ni un método.
 */
@Injectable()
export class PartnerPaymentClaimsService {
  constructor(
    @InjectModel(LoanPaymentClaimModel) private readonly claims: typeof LoanPaymentClaimModel,
    private readonly storage: DocumentStorageService,
    @InjectModel(EvidenceDocumentModel) private readonly evidences: typeof EvidenceDocumentModel,
    private readonly payments: LoanPaymentService,
    private readonly partners: PartnerProfileService,
    private readonly events: EventsService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly contexto: PaymentClaimsContextService,
  ) {}

  /** Lo que este comercio tiene esperando que confirme. */
  async listForPartner(input: { tenantId: string; partnerProfileId: string; onlyPending: boolean; currentUser: AuthenticatedUser }) {
    const profile = await this.partners.requireProfile(input.tenantId, input.partnerProfileId);
    assertOwnPartnerResource(input.currentUser, profile.ownerMerchantUserId);

    const claims = await this.claims.findAll({
      where: {
        tenantId: input.tenantId,
        partnerProfileId: input.partnerProfileId,
        deleted: false,
        ...(input.onlyPending ? { status: PENDIENTE } : {}),
      },
      order: [['submitted_at', 'DESC']],
      limit: 200,
    });

    return {
      partnerProfileId: input.partnerProfileId,
      claims: claims.map((claim) => ({
        claimId: String(claim.id),
        claimCode: claim.claimCode,
        installmentId: String(claim.installmentId),
        claimedAmount: claim.claimedAmount,
        currencyCode: claim.currencyCode,
        payerReference: claim.payerReference,
        proofEvidenceId: claim.proofEvidenceId ? String(claim.proofEvidenceId) : null,
        status: claim.status,
        submittedAt: claim.submittedAt,
        decidedAt: claim.decidedAt,
      })),
    };
  }

  /**
   * El comprobante que el cliente subió, para que el comercio lo MIRE antes de decidir.
   *
   * La cola de verificación enseñaba el importe declarado y la referencia del banco, pero no la
   * imagen: el comercio tenía que confirmar o rechazar una transferencia sin ver el papel que la
   * respalda. Eso no es verificar, es apostar — y el botón «verificar y dar por pagado» registra un
   * pago real sobre el préstamo.
   *
   * Se sirven los bytes y no una URL prefirmada porque un enlace firmado funciona sin sesión
   * mientras no venza: el comprobante bancario de una persona no debe quedar accesible a quien
   * tenga el enlace. Cada lectura pasa por el token del comercio y por la comprobación de que ese
   * comprobante llegó A ÉL.
   */
  async readProof(input: {
    tenantId: string;
    partnerProfileId: string;
    claimId: string;
    currentUser: AuthenticatedUser;
  }): Promise<{ bytes: Buffer; contentType: string }> {
    const profile = await this.partners.requireProfile(input.tenantId, input.partnerProfileId);
    assertOwnPartnerResource(input.currentUser, profile.ownerMerchantUserId);

    const claim = await this.claims.findOne({
      where: { tenantId: input.tenantId, id: input.claimId, deleted: false },
    });
    if (!claim) throw new NotFoundException('PAYMENT_CLAIM_NOT_FOUND');
    if (String(claim.partnerProfileId) !== String(input.partnerProfileId)) {
      throw new ForbiddenException('El comprobante no llegó a este comercio.');
    }
    if (!claim.proofEvidenceId) throw new NotFoundException('PAYMENT_CLAIM_WITHOUT_PROOF');

    const evidence = await this.evidences.findOne({
      where: { tenantId: input.tenantId, id: claim.proofEvidenceId, deleted: false },
    });
    if (!evidence?.s3Key) throw new NotFoundException('EVIDENCE_OBJECT_NOT_FOUND');

    const bytes = await this.storage.readObject(evidence.s3Key);
    if (!bytes) throw new NotFoundException('EVIDENCE_OBJECT_NOT_FOUND');
    return { bytes, contentType: evidence.mimeType ?? 'application/octet-stream' };
  }

  /**
   * El comercio confirma que ese dinero entró —o dice por qué no—.
   *
   * Verificar registra el pago de verdad reutilizando `LoanPaymentService`, que es quien sabe
   * repartirlo entre capital, interés y mora y quien controla la idempotencia. Duplicar ese reparto
   * aquí habría creado una segunda forma de cobrar que se desincroniza de la primera.
   *
   * ## Una sola transacción (P-08, 2026-09-24)
   *
   * Antes eran tres escrituras sueltas: el cobro en su propia transacción, el cambio de estado del
   * aviso en otra y el evento —por `EventsService`, que no recibía transacción— en una tercera. Una
   * caída entre ellas dejaba el dinero aplicado con el aviso «pendiente» o, al revés, el cliente
   * avisado de una confirmación cuyo cobro no existía. Ahora aviso, cobro, cuota y evento se
   * confirman juntos o no se confirma ninguno.
   *
   * El aviso se lee con `FOR UPDATE` y después se bloquea el préstamo: dos confirmaciones
   * simultáneas se ORDENAN, y la segunda encuentra el aviso ya decidido (409) en vez de cobrar otra
   * vez. Una confirmación sobre una cuota que otro cobro ya saldó se rechaza con
   * `INSTALLMENT_ALREADY_PAID` sin tocar nada: el comercio decide si devuelve ese dinero o lo
   * rechaza con motivo; aplicarlo solo a la cuota siguiente sería decidir un prepago por el cliente.
   */
  async decide(input: {
    tenantId: string;
    partnerProfileId: string;
    claimId: string;
    body: DecidePaymentClaimDto;
    currentUser: AuthenticatedUser;
  }) {
    const profile = await this.partners.requireProfile(input.tenantId, input.partnerProfileId);
    assertOwnPartnerResource(input.currentUser, profile.ownerMerchantUserId);

    return this.sequelize.transaction(async (transaction) => {
      const claim = await this.claims.findOne({
        where: { tenantId: input.tenantId, id: input.claimId, deleted: false },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!claim) throw new NotFoundException('PAYMENT_CLAIM_NOT_FOUND');
      if (String(claim.partnerProfileId) !== String(input.partnerProfileId)) {
        throw new ForbiddenException('El comprobante no llegó a este comercio.');
      }
      if (claim.status !== PENDIENTE) throw new ConflictException('PAYMENT_CLAIM_NOT_PENDING');

      const now = new Date();
      const decidedBy = input.currentUser.merchantUserId ?? null;

      if (!input.body.verified) {
        await this.contexto.lockLoan(input.tenantId, String(claim.loanId), transaction);
        await claim.update(
          { status: 'rejected', decidedAt: now, decidedByMerchantUserId: decidedBy, rejectionReason: input.body.reason ?? null },
          { transaction },
        );
        await this.publicarDecision({
          tenantId: input.tenantId,
          claim,
          eventCode: 'payment.rejected',
          extra: { reason: input.body.reason ?? null },
          transaction,
        });
        return { claimId: String(claim.id), status: claim.status, loanPaymentId: null };
      }

      await this.contexto.lockOpenInstallment(input.tenantId, String(claim.loanId), String(claim.installmentId), transaction);
      const registrado = await this.payments.registerPayment({
        tenantId: input.tenantId,
        loanId: String(claim.loanId),
        body: {
          amount: claim.claimedAmount,
          currencyCode: claim.currencyCode,
          paymentMethod: 'bank_transfer',
          externalReference: claim.payerReference ?? claim.claimCode,
        } as never,
        currentUser: input.currentUser,
        /* El codigo del reclamo ES la clave de idempotencia: verificar dos veces no cobra dos veces. */
        idempotencyKey: claim.claimCode,
        transaction,
      });

      await claim.update(
        { status: 'verified', decidedAt: now, decidedByMerchantUserId: decidedBy, loanPaymentId: String(registrado.paymentId) },
        { transaction },
      );
      await this.publicarDecision({
        tenantId: input.tenantId,
        claim,
        eventCode: 'payment.confirmed',
        extra: { loanPaymentId: String(registrado.paymentId) },
        transaction,
      });
      return { claimId: String(claim.id), status: claim.status, loanPaymentId: String(registrado.paymentId) };
    });
  }

  /**
   * La decisión del comercio, avisada al cliente por el mismo camino que su aviso llegó aquí, y
   * hacia quien concilia la cuota: con su versión de agregado y DENTRO de la transacción.
   */
  private async publicarDecision(ctx: {
    tenantId: string;
    claim: LoanPaymentClaimModel;
    eventCode: 'payment.confirmed' | 'payment.rejected';
    extra: Record<string, unknown>;
    transaction: Transaction;
  }): Promise<void> {
    const { tenantId, claim, eventCode, extra, transaction } = ctx;
    const installmentId = String(claim.installmentId);
    const aggregateVersion = await nextInstallmentVersion(this.sequelize, { tenantId, installmentId }, transaction);
    await this.events.publish(
      {
        tenantId,
        eventCode,
        aggregateType: INSTALLMENT_AGGREGATE,
        aggregateId: installmentId,
        aggregateVersion,
        payload: {
          claimId: String(claim.id),
          claimCode: claim.claimCode,
          loanId: String(claim.loanId),
          installmentId,
          customerId: String(claim.customerId),
          partnerProfileId: claim.partnerProfileId ? String(claim.partnerProfileId) : null,
          amount: claim.claimedAmount,
          currencyCode: claim.currencyCode,
          decidedAt: claim.decidedAt,
          aggregateVersion,
          ...extra,
        },
        idempotencyKey: `${claim.claimCode}-${eventCode}`,
        sourceModule: 'loan-payment-claims',
        sourceAction: 'decide',
      },
      { transaction },
    );
  }
}
