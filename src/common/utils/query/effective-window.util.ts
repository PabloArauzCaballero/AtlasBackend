/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace que «vigente» signifique lo mismo en todas las lecturas: ya empezó y todavía no terminó.
 * @system devuelve las dos condiciones de ventana (`effectiveFrom`/`effectiveUntil`) para el `Op.and` de un WHERE de Sequelize.
 */
import { Op } from 'sequelize';

/** Vigente en `now`: sin inicio o ya iniciado, y sin fin o con el fin todavía por llegar. */
export function effectiveAt(now: Date = new Date()): unknown[] {
  return [
    { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
    { [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: now } }] },
  ];
}
