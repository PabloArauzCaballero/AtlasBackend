/**
 * @file Dominio: el NIVEL Atlas medido en PUNTOS (los que se ganan pagando a tiempo las compras).
 * @business Pablo (2026-10-06): el nivel salía «24 de 100» porque se medía sobre la Calificación. El nivel es la
 *   escalera de los PUNTOS: cuantas más compras pagas a tiempo, más alto. La Calificación (1-100) es otra cosa.
 *   Los escalones son un supuesto (A1 del plan `docs/trabajo/2026-10-06-correcciones-app-real/PLAN.md` de
 *   AtlasFrontend) y se cambian aquí.
 * @system función pura. Es PRESENTACIÓN y estatus: decide el nivel y la tarjeta Normal…Black que se enseñan, NO el
 *   monto. El motor sigue recibiendo la puntuación de relación (`payment-capacity.ts`) como antes.
 */
import type { TierCode } from './relationship-progress.js';

const ESCALONES: ReadonlyArray<{ code: TierCode; label: string; from: number }> = [
  { code: 'NUEVO', label: 'Nuevo', from: 0 },
  { code: 'EN_CONSTRUCCION', label: 'En construcción', from: 500 },
  { code: 'ESTABLECIDO', label: 'Establecido', from: 2_000 },
  { code: 'CONSOLIDADO', label: 'Consolidado', from: 5_000 },
  { code: 'PREFERENTE', label: 'Preferente', from: 10_000 },
];

export type PointsLevel = {
  level: { code: TierCode; label: string; index: number; of: number; points: number };
  nextLevel: { code: TierCode; label: string; from: number; pointsMissing: number } | null;
  levelLadder: Array<{ code: TierCode; label: string; from: number; reached: boolean }>;
};

export function buildPointsLevel(points: number): PointsLevel {
  const puntos = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  let indice = 0;
  for (let i = 0; i < ESCALONES.length; i += 1) if (puntos >= ESCALONES[i]!.from) indice = i;
  const actual = ESCALONES[indice]!;
  const siguiente = ESCALONES[indice + 1];
  return {
    level: { code: actual.code, label: actual.label, index: indice + 1, of: ESCALONES.length, points: puntos },
    nextLevel: siguiente
      ? { code: siguiente.code, label: siguiente.label, from: siguiente.from, pointsMissing: siguiente.from - puntos }
      : null,
    levelLadder: ESCALONES.map((e) => ({ code: e.code, label: e.label, from: e.from, reached: puntos >= e.from })),
  };
}
