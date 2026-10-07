/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza cumple la promesa de recalcular la capacidad de pago en 24 horas.
 * @system manda el extracto subido al worker del motor y aplica su veredicto sobre la línea.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { env } from '../../../config/env.js';
import { BankStatementReviewModel } from '../../../database/models/index.js';
import { BankStatementEngineClient, type StatementRun } from '../../decision-engine/bank-statement-engine.client.js';
import { ineligibleCopyFor, rejectionCopyForRun, type RejectionCopy } from '../domain/statement-rejection.js';
import { BankStatementHumanReviewSync, type HumanReviewSyncOutcome } from './bank-statement-human-review.sync.js';
import { closeAsRejected, parkForHumanReview } from './bank-statement-review.outcomes.js';
import { BankStatementService } from './bank-statement.service.js';

/**
 * Quien de verdad atiende la cola de extractos.
 *
 * ## Qué hace ahora, y qué dejó de hacer
 *
 * Descarga el PDF y **se lo manda al worker de extractos del motor**. Ya no lo lee: el lector de
 * expresiones regulares que vivía aquí —sumaba lo que decía «abono», restaba lo que decía «cargo»—
 * desapareció, y con él sus tres defectos. No sabía de quién era el documento, contaba como ingreso
 * los traspasos entre cuentas del propio titular, y miraba el periodo que fuera aunque fuese un solo
 * mes.
 *
 * El motor sí sabe: tiene el padrón de ASFI, siete analizadores verificados de bancos bolivianos,
 * reconocimiento óptico, tres compuertas de admisión —contenedor, contenido y emisor— y una
 * evaluación de capacidad de pago que exige tres meses naturales completos. Mantener aquí una
 * segunda implementación de la misma regla sólo garantizaba que algún día discreparan.
 *
 * ## Los cuatro desenlaces, y por qué son cuatro
 *
 * - **Analizado**: hay capacidad de pago y la línea se recalcula.
 * - **Rechazado**: el motor demostró que el documento no sirve, y sabe POR QUÉ. Se le dice a la
 *   persona con una frase que puede resolver: no es lo mismo subir otro documento, subir el mismo
 *   sin editar, o subir el mismo con más meses.
 * - **En revisión**: hay duda real y la mira una persona en el motor. Ni se aplica ni se rechaza
 *   aquí: lo cierra {@link BankStatementHumanReviewSync} cuando la persona decide (por el aviso del
 *   motor o, si se pierde, en la pasada siguiente de este mismo trabajo).
 * - **Motor no disponible**: NO se toca la revisión. Un motor caído no es un extracto inválido, y
 *   convertirlo en rechazo le diría al cliente que su documento no sirve por una avería que es
 *   nuestra. Se queda en `received` y el siguiente barrido lo reintenta —el motor deduplica por
 *   huella, así que reintentar no repite trabajo—.
 *
 * ## Por qué el plazo se vigila aunque nadie lo reclame
 *
 * Porque un compromiso que sólo se comprueba cuando alguien se queja no es un compromiso. Las
 * revisiones que se acercan a su vencimiento sin resolverse se registran como incumplimiento
 * inminente antes de que venza, que es cuando todavía se puede hacer algo.
 */
@Injectable()
export class BankStatementReviewWorker {
  private readonly logger = new Logger(BankStatementReviewWorker.name);

  constructor(
    @InjectModel(BankStatementReviewModel) private readonly reviews: typeof BankStatementReviewModel,
    private readonly statements: BankStatementService,
    private readonly storage: DocumentStorageService,
    private readonly engine: BankStatementEngineClient,
    private readonly humanReviews: BankStatementHumanReviewSync,
  ) {}

  async processPending(input: { tenantId: string; limit: number; now?: Date }): Promise<{
    picked: number;
    applied: number;
    unreadable: number;
    inReview: number;
    failed: number;
    breachingSoon: number;
    /** Revisiones que esperaban a una persona del motor, releídas en esta pasada. */
    humanReviews: Record<HumanReviewSyncOutcome, number>;
  }> {
    const now = input.now ?? new Date();

    const pending = await this.reviews.findAll({
      where: { tenantId: input.tenantId, status: 'received', deleted: false },
      // El que lleva más tiempo sin tocarse primero. Una fila nueva nace con `_updated_at` igual a su
      // llegada, así que se atiende por orden de llegada; una que falla se marca (`deferFailed`) y
      // pasa al final. Ordenar sólo por llegada dejaba a los que fallan siempre —un PDF de más de
      // 15 MB, un objeto borrado— ocupando el lote para siempre y a los demás sin turno.
      order: [['_updated_at', 'ASC']],
      limit: input.limit,
    } as FindOptions);

    let applied = 0;
    let unreadable = 0;
    let inReview = 0;
    let failed = 0;

    for (const review of pending) {
      try {
        const outcome = await this.processOne(review, now);
        if (outcome === 'applied') applied += 1;
        else if (outcome === 'unreadable') unreadable += 1;
        else if (outcome === 'review') inReview += 1;
        else {
          failed += 1;
          await this.deferFailed(review, now);
        }
      } catch (error) {
        failed += 1;
        this.logger.error(`No se pudo procesar el extracto ${review.id}: ${(error as Error).message}`);
        await this.deferFailed(review, now);
      }
    }

    // Después de las nuevas: las que llevan horas esperando a una persona no le quitan el turno a
    // un extracto recién subido, y el aviso del motor ya cierra la mayoría antes de esta pasada.
    const humanReviews = await this.humanReviews.syncParked({ tenantId: input.tenantId, limit: input.limit, now });
    const breachingSoon = await this.warnAboutImminentBreaches(input.tenantId, now);
    return { picked: pending.length, applied, unreadable, inReview, failed, breachingSoon, humanReviews };
  }

  /** Marca el intento: la fila sigue `received` pero cede el turno a las que aún no se probaron. */
  private async deferFailed(review: BankStatementReviewModel, now: Date): Promise<void> {
    try {
      review.updatedAtValue = now;
      await review.save();
    } catch (error) {
      this.logger.warn(`Extracto ${review.id}: no se pudo marcar el intento: ${(error as Error).message}`);
    }
  }

  private async processOne(review: BankStatementReviewModel, now: Date): Promise<'applied' | 'unreadable' | 'review' | 'failed'> {
    if (!review.storageKey) {
      await this.reject(review, null, rejectionCopyForRun(null, null), now);
      return 'unreadable';
    }

    const file = await this.storage.readObject(review.storageKey);
    if (!file) {
      // El archivo no está o el almacén no responde. NO se rechaza: rechazar por una avería de
      // infraestructura le diría al cliente que su extracto era inválido cuando el problema es
      // nuestro. Se deja en `received` y la siguiente pasada vuelve a intentarlo.
      this.logger.warn(`Extracto ${review.id}: no se pudo leer el objeto ${review.storageKey}.`);
      return 'failed';
    }

    const outcome = await this.engine.analyze({
      fileName: `extracto-${review.id}.pdf`,
      bytes: file,
      correlationId: `bank-statement-${review.id}`,
    });

    if (outcome.kind === 'engineUnavailable') {
      this.logger.warn(`Extracto ${review.id}: el motor no respondió (${outcome.reason}). Queda en cola.`);
      return 'failed';
    }
    if (outcome.kind === 'rejected') {
      await this.reject(review, outcome.run, rejectionCopyForRun(outcome.run.errorCode, outcome.run.rejectionReason), now);
      return 'unreadable';
    }
    if (outcome.kind === 'review') {
      await parkForHumanReview(review, outcome.run, now);
      this.logger.log(`Extracto ${review.id} derivado a revisión humana: ${outcome.run.reviewReason ?? outcome.run.status}.`);
      return 'review';
    }

    const affordability = outcome.run.result?.affordability ?? null;
    /*
     * Un análisis SIN capacidad utilizable no se aplica: aplicarlo escribiría ceros en la línea del
     * cliente —un ingreso reconocido de cero se lee como «no gana nada»—.
     *
     * Y tampoco se aparca, que es lo que hacía antes: el motor lo dio por ANALIZADO, así que su
     * bandeja de revisión no lo tiene y ninguna persona lo iba a mirar nunca. La revisión quedaba
     * `processing` para siempre y el cliente no podía subir otro extracto. Se cierra con el motivo
     * que sí puede resolver (casi siempre: faltan meses completos).
     */
    if (!affordability?.eligible) {
      await this.reject(review, outcome.run, ineligibleCopyFor(affordability), now);
      return 'unreadable';
    }

    await this.statements.applyReview({
      tenantId: review.tenantId,
      customerId: review.customerId,
      reviewId: review.id,
      run: outcome.run,
      // Sin usuario interno: lo revisó el sistema. Dejarlo nulo es la lectura honesta del campo, y
      // atribuírselo a un operador que no lo miró falsearía la trazabilidad de la decisión.
      reviewedByInternalUserId: null,
      now,
    });
    return 'applied';
  }

  /** Cierra la revisión con el motivo del motor, traducido a algo que la persona pueda resolver. */
  private async reject(review: BankStatementReviewModel, run: StatementRun | null, copy: RejectionCopy, now: Date): Promise<void> {
    await closeAsRejected(review, run, copy, now);
    this.logger.log(`Extracto ${review.id} rechazado: ${copy.category} (${run?.errorCode ?? run?.rejectionReason ?? 'sin código'}).`);
  }

  /**
   * Avisa de los compromisos que van a vencer, mientras todavía se pueden cumplir.
   *
   * Cuenta las revisiones abiertas cuyo plazo está por agotarse. No las resuelve —resolverlas es lo
   * que hace el resto de este trabajo— pero deja constancia de que existen: un compromiso que se
   * incumple en silencio es indistinguible de uno que nunca se hizo.
   */
  private async warnAboutImminentBreaches(tenantId: string, now: Date): Promise<number> {
    const horizon = new Date(now.getTime() + env.RUNTIME_JOBS_BANK_STATEMENT_ESCALATE_BEFORE_MINUTES * 60_000);
    const atRisk = await this.reviews.count({
      where: {
        tenantId,
        status: ['received', 'processing'],
        deleted: false,
        promisedBy: { [Op.lte]: horizon },
      },
    } as FindOptions);

    if (atRisk > 0) {
      this.logger.warn(`${atRisk} revisión(es) de extracto con el plazo de 24 h a punto de vencer y sin resolver.`);
    }
    return atRisk;
  }
}
