/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza cumple la promesa de recalcular la capacidad de pago en 24 horas.
 * @system lee el extracto subido, extrae sus señales y dispara el recálculo de la línea.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { env } from '../../../config/env.js';
import { BankStatementReviewModel } from '../../../database/models/index.js';
import { extractPdfText } from '../domain/pdf-text.util.js';
import { readBankStatement } from '../domain/bank-statement-reader.js';
import { BankStatementService } from './bank-statement.service.js';

/**
 * Quien de verdad atiende la cola de extractos.
 *
 * ## El agujero que cierra
 *
 * La app le prometía al cliente un recálculo «en un máximo de 24 horas» y esa promesa no tenía nada
 * detrás: la revisión se creaba en `received` y ahí se quedaba para siempre. `applyReview` —el
 * método que aplica el resultado— no lo llamaba NADIE, ni un job, ni un endpoint. El plazo era una
 * frase de la pantalla.
 *
 * ## Qué hace, y qué admite que no puede hacer
 *
 * Descarga el PDF, le saca el texto y busca en él las señales que la política necesita: rechazos por
 * fondos insuficientes, ingresos y egresos del período. Con eso pide el recálculo al motor, que es
 * quien decide — aquí no se calcula ningún límite.
 *
 * Un extracto escaneado no tiene texto que sacar. En ese caso NO se inventa un cero: cero rechazos
 * es un dato excelente para el cliente, y regalárselo porque el archivo era una foto sería premiar
 * la ilegibilidad. Se marca la revisión como rechazada con su motivo y se le pide el PDF que
 * descarga del banco, que es el que sí se puede leer.
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
  ) {}

  async processPending(input: { tenantId: string; limit: number; now?: Date }): Promise<{
    picked: number;
    applied: number;
    unreadable: number;
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
    let failed = 0;

    for (const review of pending) {
      try {
        const outcome = await this.processOne(review, now);
        if (outcome === 'applied') applied += 1;
        else if (outcome === 'unreadable') unreadable += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`No se pudo procesar el extracto ${review.id}: ${(error as Error).message}`);
      }
    }

    const breachingSoon = await this.warnAboutImminentBreaches(input.tenantId, now);
    return { picked: pending.length, applied, unreadable, failed, breachingSoon };
  }

  private async processOne(review: BankStatementReviewModel, now: Date): Promise<'applied' | 'unreadable' | 'failed'> {
    if (!review.storageKey) {
      await this.reject(review, 'STORAGE_KEY_MISSING', now);
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

    const text = extractPdfText(file);
    const reading = readBankStatement(text);

    if (!reading.readable) {
      await this.reject(review, 'STATEMENT_NOT_READABLE', now);
      return 'unreadable';
    }

    await this.statements.applyReview({
      tenantId: review.tenantId,
      customerId: review.customerId,
      reviewId: review.id,
      nsfCount: reading.nsfCount,
      observedMonthlyIncome: reading.monthlyIncome,
      observedMonthlyExpense: reading.monthlyExpense,
      // Sin usuario interno: lo revisó el sistema. Dejarlo nulo es la lectura honesta del campo, y
      // atribuírselo a un operador que no lo miró falsearía la trazabilidad de la decisión.
      reviewedByInternalUserId: null,
      now,
    });
    return 'applied';
  }

  private async reject(review: BankStatementReviewModel, reason: string, now: Date): Promise<void> {
    review.status = 'rejected';
    review.rejectionReason = reason;
    review.reviewedAt = now;
    review.updatedAtValue = now;
    await review.save();
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
