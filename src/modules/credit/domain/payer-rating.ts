/**
 * @file Dominio: la Calificación de pagador (1-100) y el Puntaje (puntos por pagar), separados.
 * @business La app mezclaba cuatro números con nombres que se pisaban. Desde 2026-10-06 (pedido de Pablo):
 *   **Puntaje** = puntos de experiencia, 1 por boliviano COMPRADO (`experience.xp`); dan el nivel y sólo suben.
 *   **Calificación** = de 1 a 100, qué tan buen pagador es la persona. Sale de la puntuación de relación ya
 *   existente (pagos a tiempo 45 %, compras terminadas 25 %, antigüedad 20 %, identidad 10 %) — supuesto A1 del
 *   plan `docs/trabajo/2026-10-06-credito-puntaje-calificacion-app/PLAN.md`, pendiente de confirmar.
 * @system función pura; no lee base de datos ni llama al motor. El 0-1000 del motor NO es ninguno de los dos.
 */
import type { Experience } from './experience.js';

export const PAYER_RATING_SCALE = { min: 1, max: 100 } as const;

export type PayerRating = { value: number; scale: typeof PAYER_RATING_SCALE };
export type PaymentPoints = { value: number; currentStreak: number; bestStreak: number };

/**
 * La escala empieza en 1 y no en 0: «0 de 100» se lee como «no existes» y la persona sin historial no es un mal
 * pagador, es alguien que todavía no pagó nada. Un valor no finito (nunca debería llegar) cae al mínimo.
 */
export function toPayerRating(relationshipScore: number): PayerRating {
  const finito = Number.isFinite(relationshipScore) ? Math.round(relationshipScore) : PAYER_RATING_SCALE.min;
  const value = Math.min(PAYER_RATING_SCALE.max, Math.max(PAYER_RATING_SCALE.min, finito));
  return { value, scale: PAYER_RATING_SCALE };
}

export function toPaymentPoints(experience: Pick<Experience, 'xp' | 'currentStreak' | 'bestStreak'>): PaymentPoints {
  return { value: experience.xp, currentStreak: experience.currentStreak, bestStreak: experience.bestStreak };
}
