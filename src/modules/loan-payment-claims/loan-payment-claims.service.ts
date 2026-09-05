/**
 * @file Caso de uso: el aviso de pago del cliente y su verificación por el comercio.
 * @business El dinero de una transferencia lo ve el comercio en su cuenta, no Atlas: por eso lo confirma él.
 * @system crea el reclamo con su comprobante y, al verificarse, registra el pago real del préstamo.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { randomUUID } from 'node:crypto';
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  type AllowedEvidenceMimeType,
  DocumentStorageService,
} from '../../common/storage/document-storage.service.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { EvidenceDocumentModel, LoanPaymentClaimModel } from '../../database/models/index.js';
import { LoansRepository } from '../loans/loans.repository.js';
import { CreditRepository } from '../credit/credit.repository.js';
import { LoanPaymentService } from '../loans/application/loan-payment.service.js';
import { PartnerProfileService } from '../partner-onboarding/application/partner-profile.service.js';
import { PartnerQrService } from '../partner-onboarding/application/partner-qr.service.js';
import { EventsService } from '../events/events.service.js';
import { assertOwnPartnerResource } from '../../common/utils/auth/ownership.util.js';
import type {
  DecidePaymentClaimDto,
  PaymentProofTicketDto,
  SubmitPaymentClaimDto,
} from './loan-payment-claims.schemas.js';

const PENDIENTE = 'pending_verification';

/** Un cobro ya recibido en un crédito del comercio, con la comisión que devengó. */
interface PagoDeCartera {
  paymentId: string;
  paymentCode: string;
  loanId: string;
  loanCode: string;
  receivedAt: string;
  amount: string;
  appliedAmount: string;
  currencyCode: string;
  paymentMethod: string;
  externalReference: string | null;
  status: string;
  reversed: boolean;
  mdrRatePercent: string;
  commissionAccrued: string;
  installmentNumbers: number[];
}

@Injectable()
export class LoanPaymentClaimsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(LoanPaymentClaimModel) private readonly claims: typeof LoanPaymentClaimModel,
    private readonly storage: DocumentStorageService,
    @InjectModel(EvidenceDocumentModel) private readonly evidences: typeof EvidenceDocumentModel,
    private readonly loans: LoansRepository,
    private readonly credit: CreditRepository,
    private readonly payments: LoanPaymentService,
    private readonly partners: PartnerProfileService,
    private readonly partnerQr: PartnerQrService,
    private readonly events: EventsService,
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
  async paymentInstruction(input: {
    tenantId: string;
    customerId: string;
    installmentId: string;
    currentUser: AuthenticatedUser;
  }) {
    this.assertOwnCustomer(input.currentUser, input.customerId);

    const { loan, installment } = await this.requireOwnInstallment(input.tenantId, input.customerId, input.installmentId);

    const debido = Number(installment.principalAmount) + Number(installment.interestAmount) + Number(installment.lateFeeAmount);
    const pagado = Number(installment.paidPrincipal) + Number(installment.paidInterest) + Number(installment.paidLateFee);
    const pendiente = Math.max(debido - pagado, 0);

    const partnerProfileId = await this.resolvePartner(input.tenantId, loan);
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
      merchant: profile
        ? { partnerProfileId: String(profile.id), displayName: profile.tradeName ?? profile.legalName }
        : null,
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
      paymentQrUnavailableReason: qr && imagen ? null : !partnerProfileId ? 'LOAN_WITHOUT_PARTNER' : !qr ? 'PARTNER_HAS_NO_PAYMENT_QR' : 'PAYMENT_QR_OBJECT_MISSING',
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

  /**
   * La cuota, buscada DENTRO de los préstamos del cliente.
   *
   * Buscarla suelta y comprobar el dueño después filtra igual, pero deja que alguien averigüe si un
   * id existe probándolos: así un id ajeno es indistinguible de uno inexistente.
   */
  private async requireOwnInstallment(tenantId: string, customerId: string, installmentId: string) {
    const loansDelCliente = await this.loans.findLoansByCustomer(tenantId, String(customerId));
    const installments = (
      await Promise.all(loansDelCliente.map((prestamo) => this.loans.findInstallments(tenantId, String(prestamo.id))))
    ).flat();
    const installment = installments.find((cuota) => String(cuota.id) === String(installmentId));
    if (!installment) throw new NotFoundException('INSTALLMENT_NOT_FOUND');

    const loan = loansDelCliente.find((prestamo) => String(prestamo.id) === String(installment.loanId));
    if (!loan) throw new NotFoundException('LOAN_NOT_FOUND');
    return { loan, installment };
  }

  createProofTicket(input: { tenantId: string; customerId: string; body: PaymentProofTicketDto; currentUser: AuthenticatedUser }) {
    this.assertOwnCustomer(input.currentUser, input.customerId);
    if (!this.storage.isConfigured()) throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');

    const contentType = this.assertMimeType(input.body.contentType);
    return this.storage.createUploadTicket({
      tenantId: input.tenantId,
      subjectId: `customer-${input.customerId}`,
      documentType: 'PAYMENT_PROOF',
      contentType,
      sizeBytes: input.body.sizeBytes,
    });
  }

  /**
   * El cliente avisa que pagó. Esto NO salda nada.
   *
   * Se comprueba el objeto realmente almacenado antes de creer sus metadatos: quien sube el archivo
   * es la parte interesada en que parezca lo que no es.
   */
  async submit(input: { tenantId: string; customerId: string; body: SubmitPaymentClaimDto; currentUser: AuthenticatedUser }) {
    this.assertOwnCustomer(input.currentUser, input.customerId);

    const { loan, installment } = await this.requireOwnInstallment(input.tenantId, input.customerId, input.body.installmentId);
    if (installment.status === 'paid') throw new ConflictException('INSTALLMENT_ALREADY_PAID');

    const metadata = await this.storage.readObjectMetadata(input.body.storageKey);
    if (!metadata) throw new UnprocessableEntityException('EVIDENCE_OBJECT_NOT_FOUND');

    const contentType = this.assertMimeType(input.body.contentType);
    const partnerProfileId = await this.resolvePartner(input.tenantId, loan);

    return this.sequelize.transaction(async (transaction) => {
      /*
       * Una cuota no puede tener DOS reclamos esperando. Lo impide tambien un indice unico, pero
       * comprobarlo aqui deja un error que se entiende en vez de una violacion de constraint.
       */
      const abierto = await this.claims.findOne({
        where: { tenantId: input.tenantId, installmentId: String(installment.id), status: PENDIENTE, deleted: false },
        transaction,
      });
      if (abierto) throw new ConflictException('PAYMENT_CLAIM_ALREADY_PENDING');

      /*
       * El comprobante se guarda donde vive el resto de la evidencia del cliente, con su hash, su
       * tipo y su bucket. Se escribe contra el modelo y no contra `CustomerOnboardingRepository`
       * porque ese repositorio no se exporta: importarlo obligaria a abrir el modulo de alta entero
       * para reutilizar una sola escritura.
       */
      const ahora = new Date();
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
          uploadedAt: ahora,
          deleted: false,
          createdAtValue: ahora,
          updatedAtValue: ahora,
        } as never,
        { transaction },
      );

      const claim = await this.claims.create(
        {
          tenantId: input.tenantId,
          claimCode: `PC-${randomUUID()}`,
          loanId: String(loan.id),
          installmentId: String(installment.id),
          customerId: String(input.customerId),
          partnerProfileId,
          claimedAmount: input.body.amount,
          currencyCode: loan.currencyCode,
          payerReference: input.body.payerReference ?? null,
          proofEvidenceId: String(evidence.id),
          status: PENDIENTE,
          submittedAt: new Date(),
          /*
           * `_deleted` es NOT NULL en la tabla y `allowNull: false` en el modelo, pero no tiene
           * defecto en el modelo: sin asignarlo, Sequelize valida el atributo ANTES de insertar y
           * rechaza el reclamo con un ValidationError —que el filtro global convierte en un 409
           * «viola una restricción de datos.»— sin llegar nunca a la base. Este camino jamás se
           * había ejecutado de punta a punta (el aviso se quedaba en el teléfono), así que el fallo
           * salió recién al enviarlo de verdad. Es el mismo arreglo que ya llevan el desembolso y el
           * registro de pago.
           */
          deleted: false,
        } as never,
        { transaction },
      );

      /*
       * El aviso al comercio. Va por el outbox y no por una llamada directa: si la entrega falla
       * —correo caido, comercio sin canal— el evento se reintenta, mientras que una llamada dentro
       * de la transaccion la habria hecho fallar entera y el cliente habria perdido su aviso por un
       * problema que no es suyo.
       */
      await this.events.publish({
        tenantId: input.tenantId,
        eventCode: 'payment.reported',
        aggregateType: 'installment',
        aggregateId: String(installment.id),
        payload: {
          claimId: String(claim.id),
          claimCode: claim.claimCode,
          partnerProfileId,
          customerId: String(input.customerId),
          amount: input.body.amount,
          currencyCode: loan.currencyCode,
          payerReference: input.body.payerReference ?? null,
        },
        idempotencyKey: claim.claimCode,
        sourceModule: 'loan-payment-claims',
        sourceAction: 'submit',
      });

      return {
        claimId: String(claim.id),
        claimCode: claim.claimCode,
        status: claim.status,
        installmentId: String(installment.id),
        submittedAt: claim.submittedAt,
      };
    });
  }

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

  /**
   * La cartera del comercio: qué le deben, quién y cuándo.
   *
   * Una sola lectura para las tres preguntas que el comercio se hace —cuánto tengo por cobrar, qué
   * cuota vence qué día, y cómo va el mes— porque las tres se responden con los mismos datos. Tres
   * endpoints separados habrían recorrido los mismos préstamos tres veces y se habrían
   * desincronizado en cuanto uno cambiara su forma de contar.
   *
   * NO lleva la identidad del cliente. El comercio necesita saber que la cuota 3 de una operación
   * suya vence el martes, no quién es la persona: darle el nombre convertiría la cartera en un
   * padrón de deudores que nadie autorizó.
   */
  async portfolioForPartner(input: { tenantId: string; partnerProfileId: string; currentUser: AuthenticatedUser }) {
    const profile = await this.partners.requireProfile(input.tenantId, input.partnerProfileId);
    assertOwnPartnerResource(input.currentUser, profile.ownerMerchantUserId);

    const applications = await this.credit.findApplicationsByPartner(input.tenantId, input.partnerProfileId, {
      onlyPendingAcceptance: false,
    });
    /* Una solicitud produce como mucho un prestamo: los que aun no desembolsaron no tienen cartera. */
    const loans = (
      await Promise.all(
        applications.map((application) => this.loans.findLoanByApplication(input.tenantId, String(application.id))),
      )
    ).filter((loan): loan is NonNullable<typeof loan> => loan !== null);

    const hoy = new Date().toISOString().slice(0, 10);
    const creditos = [];
    /* Los cobros ya recibidos, con la comisión que devengó cada uno. Se ordenan al final. */
    const pagosRecibidos: PagoDeCartera[] = [];
    const porDia = new Map<string, { fecha: string; cuotas: number; monto: number }>();
    let saldoPorCobrar = 0;
    let montoVencido = 0;
    let cuotasVencidas = 0;
    /* Las tres cestas que el comercio distingue de un vistazo: mora, pendiente y pagado. */
    let cuotasPendientes = 0;
    let cuotasPagadas = 0;
    let cobradoTotal = 0;
    /* La tasa de comisión del comercio y lo que se le ha devengado a Atlas por cobrar. */
    const tasaMdr = Number(profile.mdrRatePercent ?? '0');
    let comisionDevengada = 0;

    for (const loan of loans) {
      const cuotas = await this.loans.findInstallments(input.tenantId, String(loan.id));
      const detalle = cuotas.map((cuota) => {
        const debido = Number(cuota.principalAmount) + Number(cuota.interestAmount) + Number(cuota.lateFeeAmount);
        const pagado = Number(cuota.paidPrincipal) + Number(cuota.paidInterest) + Number(cuota.paidLateFee);
        const pendiente = Math.max(debido - pagado, 0);
        const vence = String(cuota.dueDate).slice(0, 10);
        const vencida = pendiente > 0 && vence < hoy;

        saldoPorCobrar += pendiente;
        cobradoTotal += pagado;
        if (pendiente === 0) cuotasPagadas += 1;
        else if (vencida) {
          montoVencido += pendiente;
          cuotasVencidas += 1;
        } else cuotasPendientes += 1;
        if (pendiente > 0) {
          const dia = porDia.get(vence) ?? { fecha: vence, cuotas: 0, monto: 0 };
          dia.cuotas += 1;
          dia.monto += pendiente;
          porDia.set(vence, dia);
        }

        return {
          installmentId: String(cuota.id),
          installmentNumber: cuota.installmentNumber,
          dueDate: vence,
          amountDue: debido.toFixed(2),
          amountPaid: pagado.toFixed(2),
          amountOutstanding: pendiente.toFixed(2),
          status: cuota.status,
          daysPastDue: cuota.daysPastDue,
          overdue: vencida,
        };
      });

      const cobradoCredito = detalle.reduce((suma, cuota) => suma + Number(cuota.amountPaid), 0);
      // La comisión de Atlas se DEVENGA sobre lo cobrado, no sobre lo aprobado: un crédito que aún
      // no paga nada no debe comisión. Cuando el crédito quede saldado, la comisión acumulada será
      // la tasa por el total cobrado —que es la venta financiada—.
      const comisionCredito = (cobradoCredito * tasaMdr) / 100;
      comisionDevengada += comisionCredito;

      pagosRecibidos.push(
        ...(await this.pagosDelCredito({
          tenantId: input.tenantId,
          loanId: String(loan.id),
          loanCode: loan.loanCode,
          cuotas,
          tasaMdr,
        })),
      );

      creditos.push({
        loanId: String(loan.id),
        loanCode: loan.loanCode,
        currencyCode: loan.currencyCode,
        principalAmount: loan.principalAmount,
        status: loan.status,
        outstanding: detalle.reduce((suma, cuota) => suma + Number(cuota.amountOutstanding), 0).toFixed(2),
        collected: cobradoCredito.toFixed(2),
        commissionAccrued: comisionCredito.toFixed(2),
        installments: detalle,
      });
    }

    const pendientesDeVerificar = await this.claims.count({
      where: { tenantId: input.tenantId, partnerProfileId: input.partnerProfileId, status: PENDIENTE, deleted: false },
    });

    return {
      partnerProfileId: input.partnerProfileId,
      summary: {
        activeCredits: creditos.filter((credito) => credito.status === 'active').length,
        totalCredits: creditos.length,
        outstanding: saldoPorCobrar.toFixed(2),
        overdueAmount: montoVencido.toFixed(2),
        overdueInstallments: cuotasVencidas,
        collected: cobradoTotal.toFixed(2),
        /* Lo que aún no vence: `outstanding` menos lo que ya está en mora. */
        pendingAmount: Math.max(saldoPorCobrar - montoVencido, 0).toFixed(2),
        pendingInstallments: cuotasPendientes,
        paidInstallments: cuotasPagadas,
        paymentsCount: pagosRecibidos.filter((pago) => !pago.reversed).length,
        proofsAwaitingVerification: pendientesDeVerificar,
        /* La comisión: su tasa, lo devengado (lo que Atlas ya ganó sobre lo cobrado). */
        mdrRatePercent: tasaMdr.toFixed(2),
        commissionAccrued: comisionDevengada.toFixed(2),
      },
      credits: creditos,
      /* Los cobros ya recibidos, del más reciente al más antiguo. */
      payments: pagosRecibidos.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
      /* El calendario: qué entra cada día, ordenado. Es la vista que pide quien maneja caja. */
      calendar: [...porDia.values()]
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map((dia) => ({ date: dia.fecha, installments: dia.cuotas, amount: dia.monto.toFixed(2), overdue: dia.fecha < hoy })),
    };
  }

  /**
   * Los cobros de UN crédito, uno a uno, con la comisión que cada uno devengó.
   *
   * La comisión de un pago sale de lo que ese pago IMPUTÓ a cuotas, no de su importe declarado. Un
   * pago revertido tiene sus imputaciones anuladas —y por tanto no devenga—, y uno imputado en
   * parte sólo devenga sobre lo que entró. Usar `payment.amount` habría hecho que una reversión
   * devengara comisión sobre dinero que volvió al cliente.
   *
   * Lo que esta lista NO puede prometer es sumar `commissionAccrued`. Ese total se calcula sobre lo
   * pagado EN LAS CUOTAS, y una cuota puede aparecer saldada sin un pago detrás —así entran las
   * carteras migradas y los datos sembrados—. La diferencia es información real y se enseña en la
   * pantalla como tal; taparla igualando una cifra a la otra habría escondido cobros sin respaldo.
   */
  private async pagosDelCredito(input: {
    tenantId: string;
    loanId: string;
    loanCode: string;
    cuotas: { id: string; installmentNumber: number }[];
    tasaMdr: number;
  }): Promise<PagoDeCartera[]> {
    const pagos = await this.loans.findPaymentsByLoan(input.tenantId, input.loanId);
    const imputaciones = await this.loans.findAllocationsByPayments(
      input.tenantId,
      pagos.map((pago) => String(pago.id)),
    );
    const numeroDeCuota = new Map(
      input.cuotas.map((cuota) => [String(cuota.id), cuota.installmentNumber] as const),
    );

    return pagos.map((pago) => {
      const suyas = imputaciones.filter((fila) => String(fila.loanPaymentId) === String(pago.id));
      const aplicado = suyas.reduce(
        (suma, fila) =>
          suma +
          Number(fila.principalApplied) +
          Number(fila.interestApplied) +
          Number(fila.lateFeeApplied),
        0,
      );

      return {
        paymentId: String(pago.id),
        paymentCode: pago.paymentCode,
        loanId: input.loanId,
        loanCode: input.loanCode,
        receivedAt: new Date(pago.receivedAt).toISOString(),
        amount: Number(pago.amount).toFixed(2),
        appliedAmount: aplicado.toFixed(2),
        currencyCode: pago.currencyCode,
        paymentMethod: pago.paymentMethod,
        externalReference: pago.externalReference,
        status: pago.status,
        reversed: pago.status === 'reversed',
        mdrRatePercent: input.tasaMdr.toFixed(2),
        commissionAccrued: ((aplicado * input.tasaMdr) / 100).toFixed(2),
        /* Qué cuotas cubrió: un pago puede saldar varias, y una cuota recibir varios pagos. */
        installmentNumbers: [
          ...new Set(suyas.map((fila) => numeroDeCuota.get(String(fila.loanInstallmentId)))),
        ]
          .filter((numero): numero is number => numero !== undefined)
          .sort((a, b) => a - b),
      };
    });
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

  /** El comercio al que hay que avisar: el que originó la operación. */
  private async resolvePartner(tenantId: string, loan: { creditApplicationId?: string | null }): Promise<string | null> {
    if (!loan.creditApplicationId) return null;
    const application = await this.credit.findApplicationById(tenantId, String(loan.creditApplicationId));
    return application?.partnerProfileId ? String(application.partnerProfileId) : null;
  }

  private assertMimeType(valor: string): AllowedEvidenceMimeType {
    const permitido = (ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(valor);
    if (!permitido) throw new UnprocessableEntityException(`EVIDENCE_CONTENT_TYPE_NOT_ALLOWED: ${valor}`);
    return valor as AllowedEvidenceMimeType;
  }

  private assertOwnCustomer(user: AuthenticatedUser, customerId: string): void {
    if (user.role !== 'customer') return;
    if (String(user.customerId ?? '') !== String(customerId)) {
      throw new ForbiddenException('No puede operar sobre otro cliente.');
    }
  }
}
