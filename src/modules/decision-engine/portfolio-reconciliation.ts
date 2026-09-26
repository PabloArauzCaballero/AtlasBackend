/**
 * @file Utilidad pura: veredicto de la conciliación de cartera Core ↔ Motor (P-11).
 * @business «No hay datos» no es «cartera sana»: la falta de información se alerta, no se aprueba.
 * @system traduce conteos del libro de préstamos y de la cola de desenlaces a un estado y sus alertas.
 */

export type PortfolioSnapshot = {
  /** ¿Puede el core hablar con el motor por el plano de gestión? Sin eso, nada de lo de abajo llega. */
  engineReportingConfigured: boolean;
  /** Préstamos concedidos (desembolsados, no cancelados) con ejecución del motor que los aprobó. */
  grantedWithExecution: number;
  /** Concedidos SIN ejecución: no se pueden atribuir a ninguna versión del artefacto. */
  grantedWithoutExecution: number;
  /** Concedidos con ejecución y ya dados de alta en el motor. */
  registeredFacilities: number;
  /** Concedidos con ejecución y sin alta después del plazo de gracia. */
  unregisteredStale: number;
  outcomesPending: number;
  outcomesExhausted: number;
  outcomesSent: number;
};

export type PortfolioReconciliation = {
  status: 'RECONCILED' | 'NO_DATA' | 'ALERT';
  alerts: string[];
  snapshot: PortfolioSnapshot;
};

/**
 * El veredicto, sin optimismo.
 *
 * - `NO_DATA`: no hay cartera atribuible que comparar. Antes, un tablero con cero créditos y cero
 *   desenlaces se leía como «todo al día»; aquí se dice que no hay con qué medir.
 * - `ALERT`: algo que el motor debería saber y no sabe —créditos sin alta, desenlaces agotados,
 *   créditos sin ejecución— o el core no puede reportar en absoluto.
 * - `RECONCILED`: sólo si hay cartera y todo lo concedido está registrado y entregándose.
 */
export function assessPortfolioReconciliation(snapshot: PortfolioSnapshot): PortfolioReconciliation {
  const alerts: string[] = [];
  if (!snapshot.engineReportingConfigured) alerts.push('ENGINE_REPORTING_NOT_CONFIGURED');
  if (snapshot.unregisteredStale > 0) alerts.push(`FACILITIES_NOT_REGISTERED:${snapshot.unregisteredStale}`);
  if (snapshot.grantedWithoutExecution > 0) alerts.push(`GRANTED_WITHOUT_EXECUTION:${snapshot.grantedWithoutExecution}`);
  if (snapshot.outcomesExhausted > 0) alerts.push(`OUTCOMES_EXHAUSTED:${snapshot.outcomesExhausted}`);
  if (snapshot.grantedWithExecution > 0 && snapshot.registeredFacilities === 0) alerts.push('NO_FACILITY_EVER_REGISTERED');

  if (alerts.length > 0) return { status: 'ALERT', alerts, snapshot };
  if (snapshot.grantedWithExecution === 0) return { status: 'NO_DATA', alerts: ['NO_ATTRIBUTABLE_PORTFOLIO'], snapshot };
  return { status: 'RECONCILED', alerts, snapshot };
}
