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
import { rejectionCopyFor } from '../domain/statement-rejection.js';
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
 * - **En revisión**: hay duda real y la mira una persona. Ni se aplica ni se rechaza.
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
  ) {}

  async processPending(input: { tenantId: string; limit: number; now?: Date }): Promise<{
    picked: number;
    applied: number;
    unreadable: number;
    inReview: number;
    failed: number;
    breachingSoon: number;
  }> {
    const now = input.now ?? new Date();

    const pending = await this.reviews.findAll({
      where: { tenantId: input.tenantId, status: 'received', deleted: false },
      // El más antiguo primero: es el que tiene menos plazo restante, y atender por orden de llegada
      // es lo único que evita que un pico de subidas deje a los primeros esperando indefinidamente.
      order: [['_created_at', 'ASC']],
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
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`No se pudo procesar el extracto ${review.id}: ${(error as Error).message}`);
      }
    }

    const breachingSoon = await this.warnAboutImminentBreaches(input.tenantId, now);
    return { picked: pending.length, applied, unreadable, inReview, failed, breachingSoon };
  }

  private async processOne(review: BankStatementReviewModel, now: Date): Promise<'applied' | 'unreadable' | 'review' | 'failed'> {
    if (!review.storageKey) {
      await this.reject(review, null, now);
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
      await this.reject(review, outcome.run, now);
      return 'unreadable';
    }
    if (outcome.kind === 'review') {
      await this.park(review, outcome.run, now);
      return 'review';
    }

    const affordability = outcome.run.result?.affordability ?? null;
    /*
     * Un análisis SIN capacidad utilizable no se aplica: se aparca en revisión.
     *
     * Puede pasar si el motor acepta el documento y su evaluación sale inelegible por una razón que
     * no llegó a rechazarlo. Aplicarlo escribiría ceros en la línea del cliente —un ingreso
     * reconocido de cero se lee como «no gana nada»— y eso es peor que no aplicar nada.
     */
    if (!affordability?.eligible) {
      await this.park(review, outcome.run, now);
      return 'review';
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

  /**
   * Cierra la revisión con el motivo del motor, traducido a algo que la persona pueda resolver.
   *
   * Guarda las tres cosas: el código técnico con el que se busca el caso, la categoría con la que se
   * mide cuál pesa, y la frase que el cliente lee. Antes había una sola cadena y con ella la app
   * decía lo mismo tanto si el documento era una factura de la luz como si cubría un mes en vez de
   * tres.
   */
  private async reject(review: BankStatementReviewModel, run: StatementRun | null, now: Date): Promise<void> {
    const copy = rejectionCopyFor(run?.errorCode ?? null);
    review.status = 'rejected';
    review.rejectionReason = copy.category;
    review.rejectionCategory = copy.category;
    review.rejectionMessage = copy.message;
    review.engineRequestId = run?.requestId ?? null;
    review.engineStatus = run?.status ?? null;
    review.engineErrorCode = run?.errorCode ?? null;
    review.reviewedAt = now;
    review.updatedAtValue = now;
    this.recordEngineFacts(review, run);
    await review.save();
    this.logger.log(`Extracto ${review.id} rechazado: ${copy.category} (${run?.errorCode ?? 'sin código'}).`);
  }

  /** Deja el caso esperando a una persona, con el motivo que dio el motor. */
  private async park(review: BankStatementReviewModel, run: StatementRun, now: Date): Promise<void> {
    review.status = 'processing';
    review.engineRequestId = run.requestId;
    review.engineStatus = run.status;
    review.engineErrorCode = run.errorCode;
    review.reviewReason = run.reviewReason;
    review.reviewedAt = now;
    review.updatedAtValue = now;
    this.recordEngineFacts(review, run);
    await review.save();
    this.logger.log(`Extracto ${review.id} derivado a revisión humana: ${run.reviewReason ?? run.status}.`);
  }

  /**
   * Lo que el motor observó del documento, se aplique o no.
   *
   * Se guarda también en el rechazo y en la revisión a propósito: saber que un extracto rechazado
   * venía del BNB y que su contenedor estaba limpio es lo que permite después preguntar «¿de qué
   * bancos llegan los documentos que no sabemos leer?», que es la pregunta con la que se decide qué
   * analizador escribir a continuación.
   */
  private recordEngineFacts(review: BankStatementReviewModel, run: StatementRun | null): void {
    const result = run?.result;
    if (!result) return;
    review.institutionCode = result.institution?.id ?? null;
    review.institutionName = result.institution?.name ?? null;
    review.authenticityVerdict = result.authenticity?.verdict ?? null;
    review.authenticityScore = result.authenticity?.suspicionScore ?? null;
    review.periodFrom = result.period?.from ?? null;
    review.periodTo = result.period?.to ?? null;
    const affordability = result.affordability;
    if (!affordability) return;
    review.affordabilityJson = affordability as unknown as Record<string, unknown>;
    review.affordabilityEligible = affordability.eligible ?? false;
    review.monthsComplete = affordability.coverage?.monthsComplete ?? null;
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
