/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza recibe el extracto del cliente y le promete un recálculo de su capacidad de pago.
 * @system encola la revisión del extracto y aplica su resultado sobre la línea de crédito.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { BankStatementReviewModel } from '../../../database/models/index.js';
import { CreditLineService } from './credit-line.service.js';

/** Lo que se le promete a quien sube su extracto. Está aquí y no en la pantalla: es un compromiso. */
export const REVIEW_SLA_HOURS = 24;

/**
 * El extracto bancario como entrada de la capacidad de pago.
 *
 * ## Qué se le promete al cliente, y por qué así
 *
 * Un plazo, no un número inmediato. Leer un extracto exige extraer movimientos, contar los rechazos
 * por fondos insuficientes y comprobar que la cuenta es suya; prometer el resultado en el acto
 * obligaría a inventarlo o a fallar delante de la persona. Se promete 24 horas y se cumple.
 *
 * ## Qué se guarda y qué no
 *
 * El archivo vive CIFRADO en el almacén de evidencia; aquí solo queda su referencia, el compromiso
 * de plazo y lo que se extrajo. Es exactamente lo que se le dice al cliente en la pantalla: sus
 * movimientos son entrada de un cálculo, no un dato que circule.
 *
 * ## Una sola revisión abierta
 *
 * Tocar el botón tres veces no abre tres colas: la base lo impide con un índice único parcial. Tres
 * promesas de 24 horas sobre el mismo expediente dejarían a la persona sin saber cuál es la suya.
 */
@Injectable()
export class BankStatementService {
  private readonly logger = new Logger(BankStatementService.name);

  constructor(
    @InjectModel(BankStatementReviewModel) private readonly reviews: typeof BankStatementReviewModel,
    private readonly creditLines: CreditLineService,
  ) {}

  /** La última revisión del cliente, abierta o no. Es lo que la app enseña como estado. */
  latest(tenantId: string, customerId: string): Promise<BankStatementReviewModel | null> {
    return this.reviews.findOne({
      where: { tenantId, customerId, deleted: false },
      order: [['_created_at', 'DESC']],
    } as FindOptions);
  }

  /**
   * Registra el extracto recién subido y arranca el reloj de las 24 horas.
   *
   * No lee el archivo: eso lo hace la revisión. Aquí solo se deja constancia del compromiso, que es
   * lo que convierte «en 24 horas» en algo comprobable y no en una frase de la pantalla.
   */
  async submit(input: {
    tenantId: string;
    customerId: string;
    storageKey: string;
    evidenceDocumentId?: string | null;
    now?: Date;
  }): Promise<BankStatementReviewModel> {
    const now = input.now ?? new Date();

    const open = await this.reviews.findOne({
      where: { tenantId: input.tenantId, customerId: input.customerId, status: ['received', 'processing'], deleted: false },
    } as FindOptions);
    if (open) throw new ConflictException('BANK_STATEMENT_REVIEW_ALREADY_OPEN');

    return this.reviews.create({
      tenantId: input.tenantId,
      customerId: input.customerId,
      evidenceDocumentId: input.evidenceDocumentId ?? null,
      storageKey: input.storageKey,
      status: 'received',
      promisedBy: new Date(now.getTime() + REVIEW_SLA_HOURS * 3_600_000),
      createdAtValue: now,
      updatedAtValue: now,
      deleted: false,
    });
  }

  /**
   * Aplica el resultado de la revisión: recalcula la línea con lo que dijo el extracto.
   *
   * El `nsfCount` NO se guarda para adorno: entra como variable del artefacto —el motor la usa para
   * bajar el puntaje de capacidad de pago— y por eso el recálculo se pide DESPUÉS de escribirlo.
   *
   * Si el motor no responde, la revisión queda en `processing` y no en `applied`: decir «aplicado»
   * sin línea nueva le diría al cliente que su extracto ya cuenta cuando no cuenta.
   */
  async applyReview(input: {
    tenantId: string;
    customerId: string;
    reviewId: string;
    nsfCount: number;
    observedMonthlyIncome?: number | null;
    observedMonthlyExpense?: number | null;
    reviewedByInternalUserId?: string | null;
    now?: Date;
  }): Promise<BankStatementReviewModel> {
    const now = input.now ?? new Date();
    const review = await this.reviews.findOne({
      where: { id: input.reviewId, tenantId: input.tenantId, customerId: input.customerId, deleted: false },
    } as FindOptions);
    if (!review) throw new NotFoundException('BANK_STATEMENT_REVIEW_NOT_FOUND');

    review.nsfCount = input.nsfCount;
    review.observedMonthlyIncome = input.observedMonthlyIncome?.toFixed(2) ?? null;
    review.observedMonthlyExpense = input.observedMonthlyExpense?.toFixed(2) ?? null;
    review.reviewedByInternalUserId = input.reviewedByInternalUserId ?? null;
    review.reviewedAt = now;
    review.status = 'processing';
    review.updatedAtValue = now;
    await review.save();

    const line = await this.creditLines.recalculate({
      tenantId: input.tenantId,
      customerId: input.customerId,
      trigger: 'bank_statement',
      bankStatementNsfCount: input.nsfCount,
    });

    if (!line) {
      this.logger.warn(`Extracto ${review.id} revisado pero el motor no recalculó; queda en processing.`);
      return review;
    }

    review.status = 'applied';
    review.appliedCreditLineId = line.id;
    review.updatedAtValue = new Date();
    await review.save();
    return review;
  }
}
