/**
 * @file Dominio: el NIVEL Atlas medido en PUNTOS de experiencia (1 por boliviano comprado, `experience.ts`).
 * @business Pablo (2026-10-06): el nivel salía «24 de 100» porque se medía sobre la Calificación. El nivel es la
 *   escalera de los PUNTOS: cuanto más compras con Atlas, más alto. La Calificación (1-100) es otra cosa.
 *   Los escalones son un supuesto (A1 del plan `docs/trabajo/2026-10-06-correcciones-app-real/PLAN.md` de
 *   AtlasFrontend) y se cambian aquí.
 * @system función pura. Es PRESENTACIÓN y estatus: decide el nivel y la tarjeta Normal…Black que se enseñan, NO el
 *   monto. El motor sigue recibiendo la puntuación de relación (`payment-capacity.ts`) como antes.
 */
import type { TierCode } from './relationship-progress.js';

/**
 * Los escalones. Pablo (2026-10-07): «aumentemos los niveles y mejoremos mucho más la variedad».
 *
 * Son DOCE, repartidos en los cinco escalones de siempre. `code` es el escalón (el de la tarjeta Normal…Black y el
 * que ya entendían las versiones anteriores de la app); `id` es único por nivel y es lo que la pantalla usa para
 * saber en cuál está. Los cinco puntos de corte originales (0, 500, 2.000, 5.000, 10.000) NO se movieron: lo que se
 * añadió son escalones intermedios, de modo que la tarjeta y los textos que ya existían siguen diciendo lo mismo.
 *
 * El diseño sigue dos ideas de conducta. Los primeros peldaños están muy cerca (100 y 500 puntos son una o dos
 * compras): subir pronto es lo que engancha, y el «ya casi» de la barra pesa más cuanto más cerca está. Los últimos
 * están lejos a propósito (Leyenda, Titán): son de quien lleva años, y el último no se alcanza por casualidad.
 */
export type LevelId =
  | 'NUEVO'
  | 'EXPLORADOR'
  | 'EN_CONSTRUCCION'
  | 'CONSTANTE'
  | 'ESTABLECIDO'
  | 'CONFIABLE'
  | 'CONSOLIDADO'
  | 'DESTACADO'
  | 'PREFERENTE'
  | 'ELITE'
  | 'LEYENDA'
  | 'TITAN';

const ESCALONES: ReadonlyArray<{ id: LevelId; code: TierCode; label: string; from: number }> = [
  { id: 'NUEVO', code: 'NUEVO', label: 'Nuevo', from: 0 },
  { id: 'EXPLORADOR', code: 'NUEVO', label: 'Explorador', from: 100 },
  { id: 'EN_CONSTRUCCION', code: 'EN_CONSTRUCCION', label: 'En crecimiento', from: 500 },
  { id: 'CONSTANTE', code: 'EN_CONSTRUCCION', label: 'Constante', from: 1_000 },
  { id: 'ESTABLECIDO', code: 'ESTABLECIDO', label: 'Establecido', from: 2_000 },
  { id: 'CONFIABLE', code: 'ESTABLECIDO', label: 'Confiable', from: 3_500 },
  { id: 'CONSOLIDADO', code: 'CONSOLIDADO', label: 'Consolidado', from: 5_000 },
  { id: 'DESTACADO', code: 'CONSOLIDADO', label: 'Destacado', from: 7_500 },
  { id: 'PREFERENTE', code: 'PREFERENTE', label: 'Preferente', from: 10_000 },
  { id: 'ELITE', code: 'PREFERENTE', label: 'Élite', from: 15_000 },
  { id: 'LEYENDA', code: 'PREFERENTE', label: 'Leyenda', from: 25_000 },
  { id: 'TITAN', code: 'PREFERENTE', label: 'Titán Atlas', from: 50_000 },
];

export type PointsLevel = {
  level: { id: LevelId; code: TierCode; label: string; index: number; of: number; points: number };
  nextLevel: { id: LevelId; code: TierCode; label: string; from: number; pointsMissing: number } | null;
  levelLadder: Array<{ id: LevelId; code: TierCode; label: string; from: number; reached: boolean }>;
};

export function buildPointsLevel(points: number): PointsLevel {
  const puntos = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  let indice = 0;
  for (let i = 0; i < ESCALONES.length; i += 1) if (puntos >= ESCALONES[i]!.from) indice = i;
  const actual = ESCALONES[indice]!;
  const siguiente = ESCALONES[indice + 1];
  return {
    level: { id: actual.id, code: actual.code, label: actual.label, index: indice + 1, of: ESCALONES.length, points: puntos },
    nextLevel: siguiente
      ? { id: siguiente.id, code: siguiente.code, label: siguiente.label, from: siguiente.from, pointsMissing: siguiente.from - puntos }
      : null,
    levelLadder: ESCALONES.map((e) => ({ id: e.id, code: e.code, label: e.label, from: e.from, reached: puntos >= e.from })),
  };
}
