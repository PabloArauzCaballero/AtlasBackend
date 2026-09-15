/**
 * @file Contrato público de Casos y Fraude (AT-029): estado de fraude de un sujeto y comandos de resolución.
 * @business Otro contexto pregunta «¿este cliente tiene fraude abierto?» y recibe un valor con revisión;
 *   resolver un caso exige permiso, motivo y la revisión que se está resolviendo: dos resoluciones
 *   incompatibles no pueden ganar las dos.
 * @system Sólo valores. El efecto bloqueante sobre la admisión de crédito queda documentado en
 *   `case-ownership.md`: la admisión lee `openFraudCaseCount` en su transacción (AT-007), no una proyección.
 */
export type FraudStatus = Readonly<{
  tenantId: string;
  customerId: string;
  openCases: number;
  highestSeverity: 'low' | 'medium' | 'high' | 'critical' | null;
  /** Mayor `_id` de caso abierto: cambia con cada apertura/cierre, sirve como revisión. */
  revision: string | null;
  readAt: string;
}>;

export interface FraudStatusPort {
  getStatus(tenantId: string, customerId: string): Promise<FraudStatus>;
}

export const FRAUD_STATUS_PORT = 'atlas.fraud.status-port';

export type FraudResolutionCommand = Readonly<{
  tenantId: string;
  caseId: string;
  /** Revisión del caso que el operador vio al decidir; si cambió, el comando recibe conflicto. */
  expectedRevision: string;
  decision: 'confirmed_fraud' | 'blocked' | 'cleared' | 'needs_more_investigation';
  reasonCode: string | null;
  actor: Readonly<{ type: string; internalUserId: string | null; permissions: readonly string[] }>;
  commandKey: string;
}>;

export const FRAUD_RESOLVE_PERMISSION = 'fraud.cases.resolve';

export type ResolutionCheck = Readonly<
  | { allowed: true }
  | { allowed: false; code: 'FRAUD_PERMISSION_DENIED' | 'FRAUD_REASON_REQUIRED' | 'FRAUD_CASE_REVISION_CONFLICT' | 'CASE_ALREADY_CLOSED' }
>;

/** Reglas puras de admisión del comando; la persistencia queda en el dueño (`FraudService`). */
export function checkResolution(command: FraudResolutionCommand, current: { revision: string; closed: boolean }): ResolutionCheck {
  if (!command.actor.permissions.includes(FRAUD_RESOLVE_PERMISSION)) return { allowed: false, code: 'FRAUD_PERMISSION_DENIED' };
  if (current.closed) return { allowed: false, code: 'CASE_ALREADY_CLOSED' };
  if (current.revision !== command.expectedRevision) return { allowed: false, code: 'FRAUD_CASE_REVISION_CONFLICT' };
  if ((command.decision === 'confirmed_fraud' || command.decision === 'blocked') && !command.reasonCode)
    return { allowed: false, code: 'FRAUD_REASON_REQUIRED' };
  return { allowed: true };
}
