/**
 * @file Puerto de estado del cliente para consumidores de sólo lectura (AT-024).
 * @business Otro contexto pregunta «¿en qué estado está este cliente y es elegible?»; no puede cambiar
 *   nada a través de este puerto, y así lo dice el tipo.
 * @system Interfaz + token. La transición de ciclo de vida NO está aquí a propósito: la ejecuta el dueño.
 */
import type { CustomerStateView, EligibilitySummary } from '../../public/customer.contracts.js';

export interface CustomerStatePort {
  getState(tenantId: string, customerId: string): Promise<CustomerStateView | null>;
  /** Evalúa con la regla vigente sin persistir evidencia. Para persistir, el dueño (`evaluateAndRecord`). */
  evaluateEligibility(tenantId: string, customerId: string): Promise<EligibilitySummary>;
}

export const CUSTOMER_STATE_PORT = 'atlas.customers.state-port';
