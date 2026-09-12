/**
 * @file Caso de uso: qué tiene que hacer el cliente para pagar su cuota.
 * @business Sin el QR del comercio delante, «pagar la cuota» es una instrucción que nadie puede seguir.
 * @system resuelve la cuota, su comercio y el QR bancario con el que se paga.
 */
import { Injectable } from '@nestjs/common';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';

import { PartnerProfileService } from '../partner-onboarding/application/partner-profile.service.js';
import { PartnerQrService } from '../partner-onboarding/application/partner-qr.service.js';
import { assertOwnCustomer, PaymentClaimsContextService } from './payment-claims.shared.js';
import { InjectModel } from '@nestjs/sequelize';
import { LoanPaymentClaimModel } from '../../database/models/index.js';

/**
 * Se separa del AVISO de pago porque son dos momentos distintos: aquí el cliente todavía no ha
 * pagado y sólo se le dice cómo hacerlo; allí ya pagó y lo está declarando. Compartían clase, y
 * entre las dos pasaban de las 300 líneas de `check:file-size`.
 */
@Injectable()
export class PaymentInstructionService {
  constructor(
    private readonly storage: DocumentStorageService,
    private readonly partners: PartnerProfileService,
    private readonly partnerQr: PartnerQrService,
    @InjectModel(LoanPaymentClaimModel) private readonly claims: typeof LoanPaymentClaimModel,
    private readonly contexto: PaymentClaimsContextService,
  ) {}

  /**
   * El permiso para subir el comprobante.
   *
   * Ticket propio y no el de onboarding: aquel exige que el cliente esté en un estado editable del
   * alta, y quien paga una cuota lleva meses activo. Reutilizarlo habría rechazado exactamente a
   * quien lo necesita.
   */
  /**
   * Dónde pagar ESTA cuota: el QR bancario del comercio, con su beneficiario y el importe exacto.
   *
   * Es lo que faltaba para que «pagar» significara algo. La app decía «se paga al QR bancario del
   * comercio» y no lo enseñaba: no existía ninguna ruta que lo devolviera, así que el cliente leía
   * una instrucción que no podía seguir. Aquí sale el QR que el comercio subió en su portal.
   *
   * ## Por qué la imagen viaja EMBEBIDA y no como enlace
   *
   * Un `<Image src>` —igual que un `<img>`— no manda cabeceras: sólo tiene una URL. Servir el QR
   * por una ruta autenticada obligaría a la app a descargarlo aparte y convertirlo en blob, y
   * servirlo por una URL prefirmada crearía un enlace que funciona sin sesión. Un QR ronda las
   * decenas de kilobytes: viaja dentro de la respuesta, en la misma llamada que ya se hace.
   *
   * ## Qué se devuelve cuando NO hay QR
   *
   * `paymentQr: null` con un motivo, no un 404. Que el comercio no haya subido su QR es un estado
   * legítimo del sistema y el cliente tiene que poder ver el resto de la instrucción —importe,
   * vencimiento, a quién le paga— para poder reclamarle al comercio. Un 404 dejaría la pantalla en
   * blanco y con la culpa aparentemente puesta en el cliente.
   */
  async paymentInstruction(input: { tenantId: string; customerId: string; installmentId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomer(input.currentUser, input.customerId);

    const { loan, installment } = await this.contexto.requireOwnInstallment(input.tenantId, input.customerId, input.installmentId);

    const debido = Number(installment.principalAmount) + Number(installment.interestAmount) + Number(installment.lateFeeAmount);
    const pagado = Number(installment.paidPrincipal) + Number(installment.paidInterest) + Number(installment.paidLateFee);
    const pendiente = Math.max(debido - pagado, 0);

    const partnerProfileId = await this.contexto.resolvePartner(input.tenantId, loan);
    const profile = partnerProfileId ? await this.partners.requireProfile(input.tenantId, partnerProfileId).catch(() => null) : null;

    /* Lo que ya se avisó de esta cuota: sin esto la pantalla ofrecería avisar dos veces del mismo pago. */
    const claimAbierto = await this.claims.findOne({
      where: { tenantId: input.tenantId, installmentId: String(installment.id), deleted: false },
      order: [['submitted_at', 'DESC']],
    });

    const qr = partnerProfileId ? await this.partnerQr.findLivePaymentQr(input.tenantId, partnerProfileId) : null;
    const imagen = qr ? await this.readQrImageSafe(qr.storageKey) : null;

    return {
      installmentId: String(installment.id),
      loanId: String(loan.id),
      loanCode: loan.loanCode,
      installmentNumber: installment.installmentNumber,
      dueDate: String(installment.dueDate).slice(0, 10),
      currencyCode: loan.currencyCode,
      amountDue: debido.toFixed(2),
      amountOutstanding: pendiente.toFixed(2),
      status: installment.status,
      merchant: profile ? { partnerProfileId: String(profile.id), displayName: profile.tradeName ?? profile.legalName } : null,
      paymentQr:
        qr && imagen
          ? {
              qrId: String(qr.id),
              bankInstitutionCode: qr.bankInstitutionCode,
              accountNumberMasked: qr.accountNumberMasked,
              /* El prefijo del hash: identifica la evidencia sin publicarla entera. */
              fingerprint: qr.sha256.slice(0, 12),
              status: qr.status,
              contentType: qr.contentType,
              imageDataUrl: `data:${qr.contentType};base64,${imagen.toString('base64')}`,
            }
          : null,
      /*
       * Por qué no hay QR, dicho con precisión. «No disponible» a secas haría que el cliente
       * llamara a Atlas por algo que sólo su comercio puede resolver.
       */
      paymentQrUnavailableReason:
        qr && imagen ? null : !partnerProfileId ? 'LOAN_WITHOUT_PARTNER' : !qr ? 'PARTNER_HAS_NO_PAYMENT_QR' : 'PAYMENT_QR_OBJECT_MISSING',
      openClaim: claimAbierto
        ? {
            claimId: String(claimAbierto.id),
            claimCode: claimAbierto.claimCode,
            status: claimAbierto.status,
            submittedAt: claimAbierto.submittedAt,
            rejectionReason: claimAbierto.rejectionReason,
          }
        : null,
    };
  }

  /**
   * La imagen del QR, o nada.
   *
   * Un objeto que ya no está en el almacenamiento no puede tumbar la instrucción entera: el cliente
   * seguiría necesitando ver cuánto debe y a quién, y un 500 aquí le esconde las dos cosas.
   */
  private async readQrImageSafe(storageKey: string): Promise<Buffer | null> {
    try {
      return await this.storage.readObject(storageKey);
    } catch {
      return null;
    }
  }
}
