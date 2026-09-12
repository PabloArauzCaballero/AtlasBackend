/**
 * @file Puerto de admisión de Crédito (AT-026): lo que la admisión necesita de Clientes, y nada más.
 * @business Bloquear al cliente durante la decisión, leer sus hechos una vez y dejar la evidencia
 *   exacta de la evaluación. Es el contrato bajo el que Crédito y Clientes comparten transacción.
 * @system Es el `eligibility` de la sesión de trabajo (`CreditWorkSession`). El adaptador local lo
 *   sirve dentro de la misma transacción; NO se declara remotizable: sin esa garantía, no hay
 *   equivalencia.
 */
export type { CreditAdmissionEligibility as CreditAdmissionPort } from './credit-unit-of-work.port.js';
