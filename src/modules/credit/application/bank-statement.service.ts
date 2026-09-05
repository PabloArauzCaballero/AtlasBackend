/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza recibe el extracto del cliente y le promete un recálculo de su capacidad de pago.
 * @system encola la revisión del extracto y aplica su resultado sobre la línea de crédito.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { BankStatementReviewModel } from '../../../database/models/index.js';
import type { StatementRun } from '../../decision-engine/bank-statement-engine.client.js';
import { ExpedienteHooksService } from '../../expedientes/application/expediente-hooks.service.js';
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
    private readonly expedienteHooks: ExpedienteHooksService,
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

    const review = await this.reviews.create({
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

    // El extracto aparece en la carpeta del cliente. El gancho no puede fallar hacia arriba: el
    // compromiso de revisión ya quedó escrito, y perderlo por un problema del explorador de
    // archivos sería cambiar una promesa al cliente por un detalle de presentación.
    await this.expedienteHooks.alRegistrarEvidencia({
      tenantId: input.tenantId,
      customerId: input.customerId,
      documentType: 'bank_statement',
      evidenceDocumentId: input.evidenceDocumentId ?? null,
      storageKey: input.storageKey,
      storageBucket: null,
      sha256: null,
      mimeType: 'application/pdf',
      sizeBytes: null,
    });
    return review;
  }

  /**
   * Aplica el resultado de la revisión: recalcula la línea con lo que dijo el extracto.
   *
   * ## Qué se escribe ANTES del recálculo, y por qué
   *
   * Todo lo que el artefacto va a leer. El motor de decisión lee la capacidad de pago de la última
   * revisión del cliente, así que pedir el recálculo antes de escribirla haría que decidiera con la
   * evaluación ANTERIOR — y el cliente vería su línea moverse un ciclo tarde, sin poder relacionarla
   * con el extracto que acababa de subir.
   *
   * ## Qué cambió respecto de la versión anterior
   *
   * Antes entraban tres cifras: rechazos por fondos, ingreso y gasto, todas calculadas por un lector
   * propio que sumaba lo que decía «abono» y restaba lo que decía «cargo». Ahora entra la evaluación
   * COMPLETA del motor, y las tres cifras que sobreviven significan otra cosa: `observedMonthlyIncome`
   * es el ingreso RECONOCIDO —mediana de tres meses, sin traspasos entre cuentas propias ni
   * desembolsos de crédito— y no la suma de todo lo que entró.
   *
   * Si el motor no responde, la revisión queda en `processing` y no en `applied`: decir «aplicado»
   * sin línea nueva le diría al cliente que su extracto ya cuenta cuando no cuenta.
   */
  async applyReview(input: {
    tenantId: string;
    customerId: string;
    reviewId: string;
    /** La ejecución del worker de extractos del motor, con su evaluación dentro. */
    run: StatementRun;
    reviewedByInternalUserId?: string | null;
    now?: Date;
  }): Promise<BankStatementReviewModel> {
    const now = input.now ?? new Date();
    const review = await this.reviews.findOne({
      where: { id: input.reviewId, tenantId: input.tenantId, customerId: input.customerId, deleted: false },
    } as FindOptions);
    if (!review) throw new NotFoundException('BANK_STATEMENT_REVIEW_NOT_FOUND');

    const result = input.run.result;
    const affordability = result?.affordability ?? null;
    const nsfCount = affordability?.signals?.nsfEvents ?? 0;

    review.engineRequestId = input.run.requestId;
    review.engineStatus = input.run.status;
    review.institutionCode = result?.institution?.id ?? null;
    review.institutionName = result?.institution?.name ?? null;
    review.authenticityVerdict = result?.authenticity?.verdict ?? null;
    review.authenticityScore = result?.authenticity?.suspicionScore ?? null;
    review.periodFrom = affordability?.coverage?.from ?? result?.period?.from ?? null;
    review.periodTo = affordability?.coverage?.to ?? result?.period?.to ?? null;

    review.nsfCount = nsfCount;
    review.observedMonthlyIncome = toDecimal(affordability?.income?.monthlyRecognized);
    review.observedMonthlyExpense = toDecimal(affordability?.expenses?.effectiveMonthly);
    review.monthlyObligations = toDecimal(affordability?.obligations?.monthly);
    review.maxAffordableInstallment = toDecimal(affordability?.capacity?.maxAffordableInstallment);
    review.incomeStabilityScore = affordability?.income?.stabilityScore ?? null;
    review.affordabilityJson = (affordability ?? null) as Record<string, unknown> | null;
    review.affordabilityEligible = affordability?.eligible ?? false;
    review.affordabilityScore = affordability?.score ?? null;
    review.affordabilityBand = affordability?.band ?? null;
    review.monthsComplete = affordability?.coverage?.monthsComplete ?? null;

    review.reviewedByInternalUserId = input.reviewedByInternalUserId ?? null;
    review.reviewedAt = now;
    review.status = 'processing';
    review.updatedAtValue = now;
    await review.save();

    const line = await this.creditLines.recalculate({
      tenantId: input.tenantId,
      customerId: input.customerId,
      trigger: 'bank_statement',
      bankStatementNsfCount: nsfCount,
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

/** Dos decimales, o `null`. Un cero escrito donde no hubo dato afirma algo falso. */
function toDecimal(value: number | null | undefined): string | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value.toFixed(2);
}
