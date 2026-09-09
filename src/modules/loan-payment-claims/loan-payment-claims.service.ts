/**
 * @file Caso de uso: el aviso de pago del cliente y su verificación por el comercio.
 * @business El dinero de una transferencia lo ve el comercio en su cuenta, no Atlas: por eso lo confirma él.
 * @system crea el reclamo con su comprobante y, al verificarse, registra el pago real del préstamo.
 */
import { ConflictException, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { randomUUID } from 'node:crypto';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { EvidenceDocumentModel, LoanPaymentClaimModel } from '../../database/models/index.js';

import { ExpedienteHooksService } from '../expedientes/application/expediente-hooks.service.js';
import { EventsService } from '../events/events.service.js';

import type { PaymentProofTicketDto, SubmitPaymentClaimDto } from './loan-payment-claims.schemas.js';
import { assertMimeType, assertOwnCustomer, PaymentClaimsContextService, PENDIENTE } from './payment-claims.shared.js';
import type { AllowedEvidenceMimeType } from '../../common/storage/document-storage.service.js';

@Injectable()
export class LoanPaymentClaimsService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(LoanPaymentClaimModel) private readonly claims: typeof LoanPaymentClaimModel,
    private readonly storage: DocumentStorageService,
    @InjectModel(EvidenceDocumentModel) private readonly evidences: typeof EvidenceDocumentModel,
    private readonly events: EventsService,
    private readonly contexto: PaymentClaimsContextService,
    private readonly expedienteHooks: ExpedienteHooksService,
  ) {}

  /**
   * La cuota, buscada DENTRO de los préstamos del cliente.
   *
   * Buscarla suelta y comprobar el dueño después filtra igual, pero deja que alguien averigüe si un
   * id existe probándolos: así un id ajeno es indistinguible de uno inexistente.
   */

  createProofTicket(input: { tenantId: string; customerId: string; body: PaymentProofTicketDto; currentUser: AuthenticatedUser }) {
    assertOwnCustomer(input.currentUser, input.customerId);
    if (!this.storage.isConfigured()) throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');

    const contentType = assertMimeType(input.body.contentType);
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
    assertOwnCustomer(input.currentUser, input.customerId);

    const { loan, installment } = await this.contexto.requireOwnInstallment(input.tenantId, input.customerId, input.body.installmentId);
    if (installment.status === 'paid') throw new ConflictException('INSTALLMENT_ALREADY_PAID');

    const metadata = await this.storage.readObjectMetadata(input.body.storageKey);
    if (!metadata) throw new UnprocessableEntityException('EVIDENCE_OBJECT_NOT_FOUND');

    const contentType = assertMimeType(input.body.contentType);
    const partnerProfileId = await this.contexto.resolvePartner(input.tenantId, loan);

    const resultado = await this.escribirReclamo({ input, loan, installment, metadata, contentType, partnerProfileId });

    /*
     * El comprobante aparece en el expediente del cliente, igual que su carnet y su extracto.
     *
     * Hasta aqui no lo hacia: `PAYMENT_PROOF` se escribia en `evidence_documents` y en el almacen,
     * pero nadie llamaba al gancho, asi que el archivo existia y la carpeta del cliente no lo
     * enseñaba. Quien revisaba el expediente veia identidad y extracto, y del pago nada — sin
     * ningun error por medio, que es lo que hizo que pasara desapercibido.
     *
     * Va DESPUES del commit, como el extracto: el gancho se traga sus errores a proposito, y
     * llamarlo dentro de la transaccion ataria el aviso de pago —que el cliente ya dio y que ya
     * disparo su evento— al explorador de archivos.
     */
    await this.expedienteHooks.alRegistrarEvidencia({
      tenantId: input.tenantId,
      customerId: String(input.customerId),
      documentType: 'payment_proof',
      evidenceDocumentId: resultado.evidenceDocumentId,
      storageKey: input.body.storageKey,
      storageBucket: this.storage.getBucket(),
      sha256: metadata.sha256Hex,
      mimeType: contentType,
      sizeBytes: String(metadata.sizeBytes),
    });

    const { evidenceDocumentId: _evidencia, ...respuesta } = resultado;
    return respuesta;
  }

  /**
   * La escritura del aviso, en una sola transaccion: la evidencia, el reclamo y su evento.
   *
   * Sale de `submit` para que alli quede visible el orden real del caso de uso —se comprueba, se
   * escribe, y solo despues se toca el expediente— y porque con el gancho `submit` pasaba de las
   * 80 lineas que admite el linter.
   */
  private escribirReclamo(ctx: {
    input: { tenantId: string; customerId: string; body: SubmitPaymentClaimDto; currentUser: AuthenticatedUser };
    loan: { id: unknown; currencyCode: string; creditApplicationId?: string | null };
    installment: { id: unknown };
    metadata: { sha256Hex: string; sizeBytes: number };
    contentType: AllowedEvidenceMimeType;
    partnerProfileId: string | null;
  }) {
    const { input, loan, installment, metadata, contentType, partnerProfileId } = ctx;
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
        evidenceDocumentId: String(evidence.id),
      };
    });
  }

  /** El comercio al que hay que avisar: el que originó la operación. */
}
