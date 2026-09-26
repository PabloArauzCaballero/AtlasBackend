/**
 * @file La forma con la que sale a la API una revisión de extracto bancario.
 * @business Lo que el cliente ve de su extracto: qué se leyó, qué falta y qué se decidió.
 * @system compone la respuesta de `BankStatementReviewModel`.
 */
import type { BankStatementReviewModel } from '../../database/models/index.js';
import { reviewCopyFor } from './domain/statement-rejection.js';

/**
 * Qué le decimos al cliente sobre el extracto que subió.
 *
 * El caso `rejected` ya NO usa esta tabla: su mensaje lo escribe el motor y lo tradujo
 * `statement-rejection.ts` a la acción concreta que resuelve el caso. Antes había una sola frase
 * —«revisa que el archivo sea el extracto completo»— y con ella la persona que subió la factura de
 * la luz, la que subió un PDF editado y la que subió un mes en vez de tres recibían exactamente lo
 * mismo. Ninguna de las tres podía saber qué hacer.
 */
const STATEMENT_COPY: Record<string, { label: string; detail: string }> = {
  received: {
    label: 'Lo estamos revisando',
    detail: 'Tu extracto llegó cifrado y está en cola. Nadie lo lee fuera del cálculo de tu capacidad de pago.',
  },
  processing: {
    label: 'Calculando tu nueva capacidad',
    detail: 'Ya leímos tu extracto y estamos recalculando cuánto puedes gastar.',
  },
  applied: {
    label: 'Listo, tu línea se actualizó',
    detail: 'Tu capacidad de pago se recalculó con los movimientos reales de tu cuenta.',
  },
  rejected: {
    label: 'No pudimos usarlo',
    detail: 'Revisa que el archivo sea el extracto completo y vuelve a subirlo.',
  },
};

/** Forma mínima de la evaluación del motor. El contrato completo vive en el motor. */
interface StatementAffordabilityJson {
  eligible?: boolean;
  score?: number;
  band?: string;
  coverage?: { monthsComplete?: number };
  income?: { monthlyRecognized?: number };
  expenses?: { effectiveMonthly?: number };
  obligations?: { monthly?: number };
  capacity?: { maxAffordableInstallment?: number };
  reasons?: { code?: string; message?: string; severity?: string }[];
}

/**
 * El rótulo y el detalle, con el motivo del motor cuando lo hay.
 *
 * El rechazo y la revisión NO se explican con una frase fija: las dos tienen motivo, y el motivo es
 * la única parte útil del mensaje. Decir «no pudimos usarlo» sin decir por qué deja a la persona
 * volviendo a subir el mismo archivo hasta que se rinde.
 */
function copyFor(review: BankStatementReviewModel): { label: string; detail: string } {
  if (review.status === 'rejected' && review.rejectionMessage) {
    return { label: 'No pudimos usarlo', detail: review.rejectionMessage };
  }
  if (review.status === 'processing' && review.reviewReason) {
    const review_ = reviewCopyFor(review.reviewReason);
    return { label: review_.title, detail: review_.message };
  }
  return STATEMENT_COPY[review.status] ?? STATEMENT_COPY.received!;
}

/**
 * Sale de `credit-line.mapper.ts` porque son dos contratos distintos que sólo compartían archivo:
 * la LÍNEA de crédito (cuánto puede gastar y por qué) y la revisión del EXTRACTO (qué se leyó del
 * PDF). Juntos pasaban de las 300 líneas de `check:file-size`.
 */
/**
 * La revisión del extracto, como la lee la app.
 *
 * Lleva `promisedBy` porque el compromiso es la mitad de la promesa: decir «en 24 horas» sin una
 * hora concreta convierte la espera en algo que no se puede comprobar. Y NO lleva nada del
 * contenido del extracto, que es exactamente lo que se le prometió a la persona.
 */
export function toBankStatementResponse(review: BankStatementReviewModel) {
  const copy = copyFor(review);
  const affordability = review.affordabilityJson as StatementAffordabilityJson | null;

  return {
    reviewId: String(review.id),
    status: review.status,
    statusLabel: copy.label,
    statusDetail: copy.detail,
    submittedAt: review.createdAtValue,
    promisedBy: review.promisedBy,
    /** Solo cuando ya se aplicó: la línea que salió del recálculo. */
    appliedCreditLineId: review.appliedCreditLineId,
    rejectionReason: review.rejectionReason,
    /**
     * La categoría del rechazo, para que la app pueda elegir un icono o una ayuda sin
     * interpretar el texto. Es un código estable; el texto se puede reescribir.
     */
    rejectionCategory: review.rejectionCategory,
    /** El banco que emitió el extracto, cuando el motor lo reconoció. */
    institutionName: review.institutionName,
    period: review.periodFrom || review.periodTo ? { from: review.periodFrom, to: review.periodTo } : null,
    /**
     * Lo que el extracto demostró, en la forma en que la persona puede reconocerlo.
     *
     * Va al cliente a propósito y con su desglose: es SU dinero, medido con SUS movimientos, y ver
     * la resta es lo que convierte un límite en algo que se entiende en vez de un veredicto. No
     * viaja ningún movimiento individual —eso es exactamente lo que se le prometió que no circula—
     * sino las cifras agregadas del cálculo.
     */
    capacity:
      affordability && affordability.eligible === true
        ? {
            monthsAnalyzed: affordability.coverage?.monthsComplete ?? null,
            monthlyIncome: affordability.income?.monthlyRecognized ?? null,
            committedExpenses: affordability.expenses?.effectiveMonthly ?? null,
            monthlyObligations: affordability.obligations?.monthly ?? null,
            maxAffordableInstallment: affordability.capacity?.maxAffordableInstallment ?? null,
            score: affordability.score ?? null,
            band: affordability.band ?? null,
            /*
             * Sólo los motivos que la persona puede ACCIONAR o entender. Los códigos internos
             * viajan igual porque la app decide cómo pintarlos, pero el texto es el mismo que se
             * escribió para ser leído por quien no es analista de riesgo.
             */
            reasons: (affordability.reasons ?? [])
              .filter((reason) => reason.severity !== 'INFO' || (affordability.reasons ?? []).length === 1)
              .map((reason) => ({
                code: reason.code ?? 'DESCONOCIDO',
                message: reason.message ?? '',
                severity: reason.severity ?? 'INFO',
              })),
          }
        : null,
  };
}
