/**
 * @file Entrada pública de Clientes (AT-024). Otros módulos importan de aquí y de ningún otro sitio.
 * @business Lo que Clientes promete al resto de Atlas: estado operativo y veredicto de elegibilidad, como valores.
 * @system Reexporta contratos y el puerto de sólo lectura con su token. Los repositorios que el módulo
 *   Nest exporta son legado hasta que sus consumidores migren (línea base de fronteras).
 */
export type { CustomerLifecycleCode, CustomerStateErrorCode, CustomerStateView, EligibilitySummary } from './customer.contracts.js';
export { CUSTOMER_STATE_ERRORS } from './customer.contracts.js';
export { CUSTOMER_STATE_PORT, type CustomerStatePort } from '../application/ports/customer-state.port.js';
