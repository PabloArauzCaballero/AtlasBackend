/**
 * @file El registro de modelos base, compuesto de sus dos mitades.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system compone los grupos de modelos que Sequelize registra al arrancar.
 */
import { BUSINESS_MODELS } from './business-models.js';
import { PLATFORM_MODELS } from './platform-models.js';

/**
 * Los modelos que no viven en un libro aparte (`LOAN_BOOK_MODELS`, `CREDIT_RATING_MODELS`,
 * `PARTNER_MODELS`, `SUPPORT_MODELS`), repartidos entre lo que describe al negocio y lo que
 * describe a la plataforma. Aquí sólo la composición.
 */
export const CORE_MODELS = [...BUSINESS_MODELS, ...PLATFORM_MODELS];
