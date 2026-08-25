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
import { EventsService } from '../events/events.service.js';
import { assertOwnPartnerResource } from '../../common/utils/auth/ownership.util.js';
import type {
  DecidePaymentClaimDto,
  PaymentProofTicketDto,
  SubmitPaymentClaimDto,
} from './loan-payment-claims.schemas.js';

const PENDIENTE = 'pending_verification';

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
    private readonly events: EventsService,
  ) {}

  /**
   * El permiso para subir el comprobante.
   *
   * Ticket propio y no el de onboarding: aquel exige que el cliente esté en un estado editable del
   * alta, y quien paga una cuota lleva meses activo. Reutilizarlo habría rechazado exactamente a
   * quien lo necesita.
   */
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

    /*
     * La cuota se busca DENTRO de los prestamos del cliente, no por su id a secas. Buscarla suelta
     * y comprobar el dueño despues filtra igual, pero deja que alguien averigue si un id existe
     * probandolos: aqui un id ajeno es indistinguible de uno inexistente.
     */
    const loansDelCliente = await this.loans.findLoansByCustomer(input.tenantId, String(input.customerId));
    const installments = (
      await Promise.all(loansDelCliente.map((prestamo) => this.loans.findInstallments(input.tenantId, String(prestamo.id))))
    ).flat();
    const installment = installments.find((cuota) => String(cuota.id) === String(input.body.installmentId));
    if (!installment) throw new NotFoundException('INSTALLMENT_NOT_FOUND');

    const loan = loansDelCliente.find((prestamo) => String(prestamo.id) === String(installment.loanId));
    if (!loan) throw new NotFoundException('LOAN_NOT_FOUND');
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
    const porDia = new Map<string, { fecha: string; cuotas: number; monto: number }>();
    let saldoPorCobrar = 0;
    let montoVencido = 0;
    let cuotasVencidas = 0;
    let cobradoTotal = 0;

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
        if (vencida) {
          montoVencido += pendiente;
          cuotasVencidas += 1;
        }
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

      creditos.push({
        loanId: String(loan.id),
        loanCode: loan.loanCode,
        currencyCode: loan.currencyCode,
        principalAmount: loan.principalAmount,
        status: loan.status,
        outstanding: detalle.reduce((suma, cuota) => suma + Number(cuota.amountOutstanding), 0).toFixed(2),
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
        proofsAwaitingVerification: pendientesDeVerificar,
      },
      credits: creditos,
      /* El calendario: qué entra cada día, ordenado. Es la vista que pide quien maneja caja. */
      calendar: [...porDia.values()]
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map((dia) => ({ date: dia.fecha, installments: dia.cuotas, amount: dia.monto.toFixed(2), overdue: dia.fecha < hoy })),
    };
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
