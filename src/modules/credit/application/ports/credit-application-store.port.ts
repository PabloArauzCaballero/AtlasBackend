/**
 * @file Puerto de persistencia de solicitudes de Crédito (AT-026).
 * @business Crear la solicitud y su evento, y saber si ya hay una viva; sin ORM en las firmas.
 * @system Es el `applications` de la sesión de trabajo (`CreditWorkSession`).
 */
export type {
  CreditApplicationStore as CreditApplicationStorePort,
  NewCreditApplication,
  NewCreditApplicationEvent,
} from './credit-unit-of-work.port.js';
