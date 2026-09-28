/**
 * @file Servicio de aplicación: coordina el motor y la revisión del extracto.
 * @business Esta pieza cierra el extracto que el motor mandó a revisión humana, para que el cliente no se quede bloqueado.
 * @system relee en el motor la ejecución de cada revisión `processing` y aplica, rechaza o espera según su estado.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { BankStatementReviewModel } from '../../../database/models/index.js';
import { BankStatementEngineClient, type StatementRun } from '../../decision-engine/bank-statement-engine.client.js';
import { ineligibleCopyFor, rejectionCopyForRun } from '../domain/statement-rejection.js';
import { closeAsRejected } from './bank-statement-review.outcomes.js';
import { BankStatementService } from './bank-statement.service.js';

/** Qué pasó con una revisión al releerla en el motor. */
export type HumanReviewSyncOutcome = 'applied' | 'rejected' | 'waiting' | 'engineUnavailable';

/** Estados del motor en los que el caso todavía no terminó: se vuelve a mirar en la pasada siguiente. */
const STILL_OPEN = new Set(['QUEUED', 'RUNNING', 'PENDING_REVIEW', 'IN_REVIEW']);

/** El motor aceptó el documento: hay análisis. */
const ANALYZED = new Set(['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'COMPLETED']);

/**
 * La vuelta de la revisión humana de extractos (A6).
 *
 * ## El defecto
 *
 * Cuando el motor dudaba de un extracto lo mandaba a su bandeja de revisión y aquí la revisión se
 * quedaba en `processing`. Nada volvía a leer lo que decidía la persona del motor, así que la
 * revisión seguía abierta para siempre: el cliente veía «en revisión» sin fin y, por el índice de
 * una sola revisión abierta, no podía subir otro extracto (`409 BANK_STATEMENT_REVIEW_ALREADY_OPEN`).
 *
 * ## Cómo se cierra ahora
 *
 * Por dos caminos que terminan aquí:
 *
 * - **El aviso del motor** (`POST /internal/credit/bank-statement-review-callback`) al resolver el
 *   caso: la vía rápida.
 * - **El barrido** del job `process_bank_statement_reviews`, que relee las revisiones `processing`
 *   acotado por su límite de lote: la red. Cubre el aviso perdido, el reproceso (que no pasa por
 *   «resolver») y la revisión cuyo recálculo de línea falló y quedó `processing` a medias.
 *
 * En los dos casos la decisión sale de la ejecución RELEÍDA con la llave de Atlas, nunca del
 * cuerpo del aviso: quien avisa sólo dice «mira ésta».
 */
@Injectable()
export class BankStatementHumanReviewSync {
  private readonly logger = new Logger(BankStatementHumanReviewSync.name);

  constructor(
    @InjectModel(BankStatementReviewModel) private readonly reviews: typeof BankStatementReviewModel,
    private readonly statements: BankStatementService,
    private readonly engine: BankStatementEngineClient,
  ) {}

  /** El barrido: las revisiones abiertas en el motor, las que menos se han tocado primero. */
  async syncParked(input: { tenantId: string; limit: number; now: Date }): Promise<Record<HumanReviewSyncOutcome, number>> {
    const counts: Record<HumanReviewSyncOutcome, number> = { applied: 0, rejected: 0, waiting: 0, engineUnavailable: 0 };
    const parked = await this.reviews.findAll({
      where: { tenantId: input.tenantId, status: 'processing', deleted: false, engineRequestId: { [Op.ne]: null } },
      order: [['_updated_at', 'ASC']],
      limit: input.limit,
    } as FindOptions);

    for (const review of parked) {
      try {
        counts[await this.syncOne(review, input.now, null)] += 1;
      } catch (error) {
        counts.engineUnavailable += 1;
        this.logger.error(`No se pudo releer el extracto ${review.id} en el motor: ${(error as Error).message}`);
      }
    }
    return counts;
  }

  /**
   * El aviso: la revisión abierta que nació de ESA ejecución del motor.
   *
   * Sin revisión abierta no es un error: el extracto pudo subirlo otro (el portal del motor, una
   * prueba) o ya se cerró por el barrido. Se responde que no había nada que aplicar.
   */
  async syncByEngineRequest(input: {
    tenantId: string;
    requestId: string;
    resolvedByInternalUserId: string | null;
    now?: Date;
  }): Promise<{ applied: boolean; outcome?: HumanReviewSyncOutcome; reason?: string }> {
    const review = await this.reviews.findOne({
      where: { tenantId: input.tenantId, engineRequestId: input.requestId, status: 'processing', deleted: false },
    } as FindOptions);
    if (!review) return { applied: false, reason: 'SIN_REVISION_ABIERTA' };
    const outcome = await this.syncOne(review, input.now ?? new Date(), input.resolvedByInternalUserId);
    return { applied: outcome === 'applied' || outcome === 'rejected', outcome };
  }

  private async syncOne(
    review: BankStatementReviewModel,
    now: Date,
    resolvedByInternalUserId: string | null,
  ): Promise<HumanReviewSyncOutcome> {
    const read = await this.engine.readRun(review.engineRequestId as string);
    if (read.kind === 'engineUnavailable') {
      this.logger.warn(`Extracto ${review.id}: no se pudo releer en el motor (${read.reason}). Sigue en revisión.`);
      return 'engineUnavailable';
    }
    const run = read.run;
    if (STILL_OPEN.has(run.status)) return 'waiting';

    if (ANALYZED.has(run.status)) {
      const affordability = run.result?.affordability ?? null;
      if (affordability?.eligible) {
        await this.statements.applyReview({
          tenantId: review.tenantId,
          customerId: review.customerId,
          reviewId: review.id,
          run,
          reviewedByInternalUserId: resolvedByInternalUserId,
          now,
        });
        this.logger.log(`Extracto ${review.id} aplicado tras la revisión humana del motor.`);
        return 'applied';
      }
      // Aceptado y sin capacidad utilizable: aplicarlo escribiría ceros en la línea.
      await this.reject(review, run, ineligibleCopyFor(affordability), now);
      return 'rejected';
    }

    /*
     * `PDF_INVALID` (la persona dijo que no era un extracto válido), `FAILED` (lo cerró sin
     * resultado) o `CANCELLED`: el motor no va a hacer nada más con esta ejecución. Se cierra con el
     * motivo más preciso que haya, para que la persona pueda subir otro.
     */
    await this.reject(review, run, rejectionCopyForRun(run.errorCode, run.rejectionReason), now);
    return 'rejected';
  }

  private async reject(review: BankStatementReviewModel, run: StatementRun, copy: ReturnType<typeof rejectionCopyForRun>, now: Date) {
    await closeAsRejected(review, run, copy, now);
    this.logger.log(`Extracto ${review.id} cerrado tras la revisión del motor: ${copy.category} (${run.status}).`);
  }
}
