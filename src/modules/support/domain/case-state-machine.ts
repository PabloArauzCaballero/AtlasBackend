/**
 * @file Regla de dominio pura: qué transición de estado de un caso es legítima.
 * @business Impide que un caso salte de «recibido» a «cerrado» sin haber sido resuelto ni comunicado.
 * @system valida contra `SUPPORT_CASE_TRANSITIONS` y traduce el estado interno al que ve el cliente.
 */
import { ConflictException } from '@nestjs/common';
import {
  CUSTOMER_VISIBLE_STATUS,
  NEVER_AUTO_CLOSE_CASE_TYPES,
  SUPPORT_CASE_TRANSITIONS,
  type SupportCaseStatus,
  type SupportCaseType,
} from '../support.constants.js';

/** Estados desde los que el expediente ya no está vivo para la operación diaria. */
const TERMINAL: readonly SupportCaseStatus[] = ['CLOSED', 'CANCELLED'];

/** Estados en los que Atlas espera a alguien externo y el reloj de resolución puede pausarse. */
const WAITING: readonly SupportCaseStatus[] = ['WAITING_CUSTOMER', 'WAITING_PARTNER', 'WAITING_INTERNAL', 'ON_HOLD'];

export function isTerminalStatus(status: SupportCaseStatus): boolean {
  return TERMINAL.includes(status);
}

export function isWaitingStatus(status: SupportCaseStatus): boolean {
  return WAITING.includes(status);
}

export function canTransition(from: SupportCaseStatus, to: SupportCaseStatus): boolean {
  return SUPPORT_CASE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Falla ANTES de escribir, con 409 y no con 500.
 *
 * Una transición imposible casi nunca es un bug del backend: es dos personas operando el mismo caso
 * a la vez, o una pantalla que quedó abierta con un estado viejo. Devolver conflicto —y decir desde
 * dónde— permite a la interfaz recargar y reintentar; un 500 la deja adivinando.
 */
export function assertTransition(from: SupportCaseStatus, to: SupportCaseStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new ConflictException({
      code: 'SUPPORT_CASE_STATE_CONFLICT',
      message: `Un caso en ${from} no puede pasar a ${to}.`,
      from,
      to,
      allowed: SUPPORT_CASE_TRANSITIONS[from] ?? [],
    });
  }
}

/** Lo que se le muestra a quien abrió el caso. Nunca el estado interno en crudo. */
export function customerVisibleStatus(status: SupportCaseStatus): string {
  return CUSTOMER_VISIBLE_STATUS[status] ?? 'En revisión';
}

/**
 * Si este caso puede cerrarse por silencio del cliente.
 *
 * Sólo cuando ya se comunicó una resolución y el tipo de caso lo admite. Seguridad, fraude, reclamo
 * y privacidad quedan fuera por definición: en esos cuatro, el silencio de una persona no es
 * conformidad, y un bloqueo legal lo impide en cualquier caso.
 */
export function canAutoClose(input: {
  status: SupportCaseStatus;
  caseType: SupportCaseType;
  legalHold: boolean;
  hasCommunicatedResolution: boolean;
}): boolean {
  if (input.legalHold) return false;
  if (NEVER_AUTO_CLOSE_CASE_TYPES.includes(input.caseType)) return false;
  if (!input.hasCommunicatedResolution) return false;
  return input.status === 'RESOLVED';
}
