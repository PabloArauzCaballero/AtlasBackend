/**
 * La frontera de unidades entre el core y el Motor.
 *
 * El libro de préstamos guarda la tasa anual como PORCENTAJE (18, 22, 24 — `loan-schedule.ts`
 * divide por 100/12 para el cronograma mensual). El Motor la exige en TANTO POR UNO: su rol
 * semántico `PRICED_RATE` pone techo 10, así que un 18 sin convertir no es "más caro", es un valor
 * que ese contrato existe para rechazar. Antes de esta función, `facility-registration.service.ts`
 * mandaba el número del libro tal cual con un comentario que afirmaba lo contrario.
 *
 * Toda conversión entre los dos lados pasa por aquí, para que fijar 18 ↔ 0,18 en una sola prueba
 * de contrato baste para vigilar los dos sentidos.
 */

/** Porcentaje del libro (18) → tanto por uno del Motor (0,18). */
export function percentToUnitRate(annualRatePercent: number): number {
  return annualRatePercent / 100;
}

/** Tanto por uno del Motor (0,18) → porcentaje del libro (18). */
export function unitRateToPercent(annualRateUnit: number): number {
  return annualRateUnit * 100;
}
