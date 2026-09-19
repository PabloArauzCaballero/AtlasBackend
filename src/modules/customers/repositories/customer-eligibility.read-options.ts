/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import type { Transaction } from 'sequelize';

/**
 * Transacción opcional de la lectura.
 *
 * `loadFacts` corría SIEMPRE fuera de transacción, y eso rompía a sus dos llamadores
 * transaccionales: `evaluateAndRecord` se encadena tras la verificación de identidad y tras el envío
 * a revisión, escrituras que todavía no habían hecho commit cuando la evaluación leía. Evaluaba
 * entonces sobre el estado ANTERIOR —seguía viendo la evidencia en `pending_review`, no promovía— y
 * persistía como evidencia una evaluación que contradecía lo que esa misma transacción acababa de
 * escribir.
 *
 * Vive en su propio archivo porque lo comparten las dos mitades de la lectura de hechos.
 */
export type EligibilityReadOptions = { transaction?: Transaction };
