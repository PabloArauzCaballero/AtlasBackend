/**
 * @file Caso de uso: lo que el COMERCIO hace con los avisos de pago que recibe.
 * @business El dinero de una transferencia lo ve el comercio en su cuenta, no Atlas: por eso lo confirma él.
 * @system resuelve la cola de avisos, sirve el comprobante y, al verificarse, registra el pago real.
 */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { EvidenceDocumentModel, LoanPaymentClaimModel } from '../../database/models/index.js';

import { LoanPaymentService } from '../loans/application/loan-payment.service.js';
import { PartnerProfileService } from '../partner-onboarding/application/partner-profile.service.js';
import { EventsService } from '../events/events.service.js';
import { assertOwnPartnerResource } from '../../common/utils/auth/ownership.util.js';
import type { DecidePaymentClaimDto } from './loan-payment-claims.schemas.js';
import { PENDIENTE } from './payment-claims.shared.js';

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

    const claim = await this.claims.findOne({
      where: { tenantId: input.tenantId, id: input.claimId, deleted: false },
    });
    if (!claim) throw new NotFoundException('PAYMENT_CLAIM_NOT_FOUND');
    if (String(claim.partnerProfileId) !== String(input.partnerProfileId)) {
      throw new ForbiddenException('El comprobante no llegó a este comercio.');
    }
    if (claim.status !== PENDIENTE) throw new ConflictException('PAYMENT_CLAIM_NOT_PENDING');

    const now = new Date();

    if (!input.body.verified) {
      await claim.update({
        status: 'rejected',
        decidedAt: now,
        decidedByMerchantUserId: input.currentUser.merchantUserId ?? null,
        rejectionReason: input.body.reason ?? null,
      });
      await this.publicarDecision(input.tenantId, claim, 'payment.rejected', { reason: input.body.reason ?? null });
      return { claimId: String(claim.id), status: claim.status, loanPaymentId: null };
    }

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
    });

    await claim.update({
      status: 'verified',
      decidedAt: now,
      decidedByMerchantUserId: input.currentUser.merchantUserId ?? null,
      loanPaymentId: String(registrado.paymentId),
    });

    await this.publicarDecision(input.tenantId, claim, 'payment.confirmed', {
      loanPaymentId: String(registrado.paymentId),
    });
    return { claimId: String(claim.id), status: claim.status, loanPaymentId: String(registrado.paymentId) };
  }

  /** La decisión del comercio, avisada al cliente por el mismo camino que su aviso llegó aquí. */
  private async publicarDecision(
    tenantId: string,
    claim: LoanPaymentClaimModel,
    eventCode: 'payment.confirmed' | 'payment.rejected',
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.events.publish({
      tenantId,
      eventCode,
      aggregateType: 'installment',
      aggregateId: String(claim.installmentId),
      payload: {
        claimId: String(claim.id),
        claimCode: claim.claimCode,
        customerId: String(claim.customerId),
        amount: claim.claimedAmount,
        currencyCode: claim.currencyCode,
        ...extra,
      },
      idempotencyKey: `${claim.claimCode}-${eventCode}`,
      sourceModule: 'loan-payment-claims',
      sourceAction: 'decide',
    });
  }
}
