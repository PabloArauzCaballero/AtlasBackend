/**
 * @file Filtros de visibilidad y de propiedad de los avisos que genera una campaña.
 * @business Un aviso de campaña con fecha de fin deja de verse en la bandeja cuando la campaña
 *   termina, y sólo sale cuando le toca según la cadencia de la campaña.
 * @system Fragmentos `where` de Sequelize. Viven aparte para que el repositorio general no crezca y
 *   para que los jobs genéricos y la bandeja apliquen exactamente la misma regla.
 */
import { Op } from 'sequelize';

/** Vigente: sin fecha de fin o con la fecha de fin aún por llegar. */
export function notExpired(now = new Date()): Record<symbol, unknown> {
  return { [Op.and]: [{ [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }] }] };
}

/**
 * Lo que pueden tocar los jobs genéricos de entrega y rescate: nunca un aviso de campaña (lo entrega
 * su runner, que respeta pausa, cadencia y cancelación) y nunca uno programado para más tarde.
 */
export function ownedByGenericJobs(now = new Date()): Record<string | symbol, unknown> {
  return { campaignId: null, [Op.or]: [{ scheduledAt: null }, { scheduledAt: { [Op.lte]: now } }] };
}
