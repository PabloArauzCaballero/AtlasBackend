/**
 * @file Registro de modelos: la lista que Sequelize carga al arrancar.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system enumera en un solo sitio los modelos que componen el esquema del backend.
 */

/**
 * TODOS los modelos que Sequelize registra, en un archivo propio.
 *
 * Es la misma convención que ya seguían `LOAN_BOOK_MODELS`, `CREDIT_RATING_MODELS` y
 * `PARTNER_MODELS`: la lista crece con cada dominio nuevo y no tiene techo natural, así que
 * arrastraba consigo el módulo de Nest —que sí es corto y estable— por encima del límite de tamaño
 * del repositorio. Separarlas deja cada cosa donde se puede leer: aquí el inventario, allí el
 * cableado.
 */
import { CORE_MODELS } from './core-models.js';
import { LOAN_BOOK_MODELS } from './loan-book-models.js';
import { CREDIT_RATING_MODELS } from './credit-rating-models.js';
import { PARTNER_MODELS } from './partner-models.js';
import { SUPPORT_MODELS } from './support-models.js';
import { CREDIT_MODELS } from '../modules/credit/infrastructure/persistence/credit-models.js';
import { NOTIFICATION_MODELS } from '../modules/notifications/infrastructure/persistence/notification-models.js';

// AT-018: cada contexto publica su registro; aquí sólo se agregan mientras el monolito comparte proceso.
export const databaseModels = [
  ...CORE_MODELS,
  ...CREDIT_MODELS,
  ...NOTIFICATION_MODELS,
  ...LOAN_BOOK_MODELS,
  ...CREDIT_RATING_MODELS,
  ...PARTNER_MODELS,
  ...SUPPORT_MODELS,
];
