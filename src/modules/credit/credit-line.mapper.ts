/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza traduce la decisión del motor a algo que el cliente pueda entender sobre su crédito.
 * @system proyecta la línea de crédito persistida al contrato que consume la app.
 */
import { BankStatementReviewModel, CreditLineModel } from '../../database/models/index.js';

/**
 * Los tramos del puntaje ATLAS, con nombre.
 *
 * El puntaje viaja como número Y como tramo porque un 785 no significa nada solo: la persona
 * necesita saber si eso es bueno, y comparado con qué. El corte es el mismo que usa la política
 * para el `pricing_tier`, de modo que lo que ve el cliente y lo que le cobran no puedan discrepar.
 */
const BANDS: Array<{ from: number; code: string; label: string; tone: 'success' | 'info' | 'warning' | 'danger' }> = [
  { from: 800, code: 'excelente', label: 'Excelente', tone: 'success' },
  { from: 700, code: 'muy_bueno', label: 'Muy bueno', tone: 'success' },
  { from: 600, code: 'bueno', label: 'Bueno', tone: 'info' },
  { from: 450, code: 'regular', label: 'Regular', tone: 'warning' },
  { from: 0, code: 'inicial', label: 'En construcción', tone: 'danger' },
];

/**
 * De un código de motivo del motor a una frase que se pueda leer sin ser analista de riesgo.
 *
 * Los códigos que no estén aquí se enseñan tal cual y NO se ocultan: un motivo sin traducir es feo,
 * pero un motivo escondido deja al cliente sin saber qué le pasó. La normativa de crédito justo
 * obliga a comunicar los motivos adversos, no a que sean bonitos.
 */
const REASON_COPY: Record<string, string> = {
  BUREAU_SCORE_TOO_LOW: 'Todavía no tenemos historial crediticio tuyo en el sistema financiero.',
  AFF_RATIO: 'La cuota que pediste compromete una parte alta de tu ingreso.',
  AFF_DISPOSABLE: 'Tus gastos declarados dejan poco margen sobre tu ingreso.',
  AFF_NSF: 'Tu extracto muestra rechazos por fondos insuficientes.',
  CR_SCORE: 'Tu comportamiento de pago todavía no alcanza el mínimo de la política.',
  CR_CHARGE_OFF: 'Hay un crédito castigado en tu historial.',
  CR_BANKRUPTCY: 'Hay una insolvencia registrada a tu nombre.',
  ELIG_EMPLOYMENT: 'La situación laboral declarada no cumple los requisitos del producto.',
  ELIG_AGE: 'La edad registrada no cumple los requisitos del producto.',
  ELIG_AMOUNT: 'El importe pedido queda fuera del rango del producto.',
  IDENTITY_KYC_INVALID: 'Falta completar la verificación de tu identidad.',
  IDENTITY_KYC_LIVENESS: 'La prueba de vida no se completó.',
  IDENTITY_KYC_ID: 'El documento de identidad no pudo validarse.',
};

/**
 * Qué le sube el puntaje a esta persona, dicho en imperativo.
 *
 * Se deriva de lo que el motor marcó como AUSENTE en su expediente, no de una lista fija de
 * consejos: recomendarle «sube tu extracto» a quien ya lo subió es ruido, y peor —le dice que el
 * sistema no mira lo que él hizo.
 */
function nextSteps(line: CreditLineModel): Array<{ code: string; label: string; detail: string }> {
  const provenance = line.provenanceJson ?? {};
  const steps: Array<{ code: string; label: string; detail: string }> = [];

  if (provenance.bank_statement_nsf_count === 'ausente') {
    steps.push({
      code: 'extracto',
      label: 'Sube tu extracto bancario',
      detail: 'Es la prueba de cuánto entra y sale de tu cuenta. Con ella tu capacidad de pago se calcula con datos, no con lo declarado.',
    });
  }
  if (provenance.income_stability_score === 'ausente') {
    steps.push({
      code: 'antiguedad',
      label: 'Completa tu antigüedad laboral',
      detail: 'Un ingreso que se sostiene en el tiempo pesa más que uno alto y reciente.',
    });
  }
  if (line.provenanceJson?.bureau_score === 'ausente') {
    /*
     * Este paso NO pide subir nada, y por eso lo dice.
     *
     * Puesto junto a «sube tu extracto» se leía como un segundo documento que hay que ir a buscar
     * —y sacar un reporte del buró es un trámite que casi nadie hace—. Lo único que se le pide al
     * cliente en toda esta pantalla es el extracto, que ya tiene en el teléfono. El historial lo
     * genera Atlas solo, con cada cuota que él paga.
     */
    steps.push({
      code: 'historial',
      label: 'Paga a tiempo y tu historial se construye solo',
      detail: 'No tienes que subir nada más: cada cuota que pagas a tiempo va creando el historial que hoy no existe en ningún buró. Es la vía más directa a subir de tramo.',
    });
  }
  return steps;
}

/**
 * El texto del motivo, con una excepción medida.
 *
 * La regla general es que MANDA el texto de la política: es el que se publicó, el que se audita y el
 * que no debe reescribir el core a su gusto.
 *
 * La excepción es `BUREAU_SCORE_TOO_LOW` cuando el buró consta como AUSENTE. Ahí la frase de la
 * política —«tu puntaje crediticio no alcanza el mínimo requerido»— afirma algo que no es cierto de
 * esta persona: no es que su puntaje sea bajo, es que no tiene ninguno porque en Bolivia no hay buró
 * conectado. Decirle a alguien que su historial es malo cuando lo que pasa es que no existe le
 * atribuye una culpa que no tiene, y encima le esconde lo único que sí puede hacer.
 *
 * Se sustituye SOLO en ese cruce concreto —código y ausencia comprobada— y no como criterio general.
 * Lo correcto de verdad es que la política publique un motivo propio para el expediente delgado; a
 * eso lleva un cambio de artefacto, y mientras tanto esto es lo que evita mentirle al cliente.
 */
function messageFor(code: string, policyMessage: string | undefined, provenance: Record<string, string>): string {
  if (code === 'BUREAU_SCORE_TOO_LOW' && provenance.bureau_score === 'ausente') {
    return REASON_COPY.BUREAU_SCORE_TOO_LOW!;
  }
  return policyMessage ?? REASON_COPY[code] ?? code;
}

export function bandOf(scoring: number | null): { code: string; label: string; tone: string } {
  const band = BANDS.find((candidate) => (scoring ?? 0) >= candidate.from) ?? BANDS[BANDS.length - 1]!;
  return { code: band.code, label: band.label, tone: band.tone };
}

/**
 * La línea de crédito tal y como la lee la app.
 *
 * Se manda el número Y su explicación: el ingreso disponible con el que se calculó, la cuota máxima
 * que sostiene, el puntaje con su tramo, los motivos y qué falta para mejorar. Un límite sin
 * explicación convierte la pantalla en un veredicto, y lo que se pidió es transparencia.
 */
export function toCreditLineResponse(line: CreditLineModel, spent = 0) {
  const approved = Number(line.approvedLimit);
  const scoring = line.scoring;

  return {
    customerId: String(line.customerId),
    currencyCode: line.currencyCode,

    approvedLimit: approved,
    /** Lo ya comprometido con préstamos vivos, para que «disponible» no lo calcule el teléfono. */
    used: Math.round(spent * 100) / 100,
    available: Math.round(Math.max(0, approved - spent) * 100) / 100,

    maxAffordableInstallment: line.maxAffordableInstallment === null ? null : Number(line.maxAffordableInstallment),
    disposableIncome: line.disposableIncome === null ? null : Number(line.disposableIncome),

    scoring,
    scoringBand: bandOf(scoring),
    /** La escala completa, para que la app pueda dibujarla sin llevarla escrita dentro. */
    scoringScale: { min: 0, max: 1000, bands: BANDS },

    riskBand: line.riskBand,
    pricingTier: line.pricingTier,
    annualPercentageRate: line.annualPercentageRate === null ? null : Number(line.annualPercentageRate),
    affordabilityScore: line.affordabilityScore,
    affordabilityDecision: line.affordabilityDecision,
    probabilityOfDefault: line.probabilityOfDefault === null ? null : Number(line.probabilityOfDefault),

    decision: {
      outcome: line.decisionOutcome,
      executionId: line.decisionExecutionId,
      artifactCode: line.artifactCode,
      artifactVersionId: line.artifactVersionId,
      /** Qué disparó este cálculo: `onboarding`, `bank_statement`, `delinquency`… */
      trigger: line.calculationTrigger,
      calculatedAt: line.validFrom,
    },

    reasons: (line.reasonCodesJson ?? []).map((raw) => {
      const reason = raw as { code?: string; message?: string; adverseAction?: boolean; category?: string };
      const code = reason.code ?? 'DESCONOCIDO';
      return {
        code,
        message: messageFor(code, reason.message, line.provenanceJson ?? {}),
        category: reason.category ?? null,
        adverseAction: reason.adverseAction === true,
      };
    }),

    /**
     * De dónde salió cada variable de la decisión.
     *
     * Va al cliente a propósito: es la diferencia entre «tu buró es malo» y «aquí no hay buró», y la
     * segunda no es culpa suya. Enseñarlo es lo que convierte un rechazo en algo accionable.
     */
    inputs: line.provenanceJson ?? {},
    nextSteps: nextSteps(line),
  };
}

/** El historial de la línea: qué cambió, cuándo y qué lo movió. */
export function toCreditLineHistoryResponse(lines: readonly CreditLineModel[]) {
  return {
    items: lines.map((line) => ({
      approvedLimit: Number(line.approvedLimit),
      scoring: line.scoring,
      scoringBand: bandOf(line.scoring),
      trigger: line.calculationTrigger,
      outcome: line.decisionOutcome,
      validFrom: line.validFrom,
      validUntil: line.validUntil,
    })),
  };
}

/** Qué le decimos al cliente sobre el extracto que subió. */
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

/**
 * La revisión del extracto, como la lee la app.
 *
 * Lleva `promisedBy` porque el compromiso es la mitad de la promesa: decir «en 24 horas» sin una
 * hora concreta convierte la espera en algo que no se puede comprobar. Y NO lleva nada del
 * contenido del extracto, que es exactamente lo que se le prometió a la persona.
 */
export function toBankStatementResponse(review: BankStatementReviewModel) {
  const copy = STATEMENT_COPY[review.status] ?? STATEMENT_COPY.received!;
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
  };
}
