/**
 * @file Catálogo de la escala de calificación, para consumirlo desde la interfaz.
 * @business Permite explicar qué significa una categoría de riesgo en lugar de enseñar una letra suelta.
 * @system deriva el catálogo de la política vigente; no declara ninguna escala propia.
 */
import type { ResolvedRatingPolicy } from './rating-policy.service.js';

/**
 * Una categoría de la escala, lista para pintarse y para explicarse.
 *
 * **Por qué el catálogo se publica y no se copia en la interfaz.** La escala es
 * regulatoria y versionada: sus letras, sus umbrales de mora y sus tasas de
 * previsión los fija una política aprobada, no el frontend. Una copia en React
 * —aunque hoy coincida— se separa el día que se apruebe una versión nueva, y
 * entonces la pantalla explica una categoría con los criterios de la política
 * anterior sin que nada falle: el número sigue siendo correcto y la explicación
 * ya no.
 *
 * **El tono no es decoración.** Se deriva de `severityRank`, que es el orden que
 * la propia política declara, así que una escala de tres categorías y una de
 * seis se pintan igual de bien sin tocar código. Fijar el color por letra sería
 * exactamente el `if grade === 'X'` que hay que evitar.
 */
export interface RatingGradeCatalogItem {
  grade: string;
  label: string;
  /** 0 es la mejor. Es el orden que la política declara, no una convención local. */
  severityRank: number;
  /** Días de mora que definen la categoría. `null` en el máximo = banda abierta. */
  minDaysPastDue: number;
  maxDaysPastDue: number | null;
  /** Tanto por uno. Es el efecto económico de caer en esta categoría. */
  provisionRate: number;
  /** Tono semántico, derivado de la POSICIÓN en la escala. */
  tone: 'success' | 'info' | 'warning' | 'critical';
  /** Frase lista para un tooltip. Explica la categoría sin abrir la política. */
  help: string;
}

export interface RatingScaleCatalog {
  policyCode: string;
  versionCode: string;
  grades: RatingGradeCatalogItem[];
}

/**
 * El tono según dónde cae la categoría dentro de SU escala.
 *
 * Se reparte por tercios sobre el número real de categorías. Con la escala ASFI
 * de seis eso da dos verdes, dos ámbar y dos rojas; con una escala comercial de
 * tres, una de cada. Un mapa fijo por letra obligaría a editarlo cada vez que el
 * negocio apruebe una escala nueva — y quien no lo editara vería categorías en
 * gris sin saber que faltaban.
 */
function toneFor(severityRank: number, total: number): RatingGradeCatalogItem['tone'] {
  if (total <= 1) return 'success';
  const posicion = severityRank / (total - 1);
  if (posicion === 0) return 'success';
  if (posicion <= 0.34) return 'info';
  if (posicion <= 0.67) return 'warning';
  return 'critical';
}

function helpFor(band: { gradeLabel: string; minDaysPastDue: number; maxDaysPastDue: number | null; provisionRate: number }): string {
  const mora =
    band.maxDaysPastDue === null
      ? `desde ${band.minDaysPastDue} días de mora`
      : band.minDaysPastDue === band.maxDaysPastDue
        ? `${band.minDaysPastDue} días de mora`
        : `entre ${band.minDaysPastDue} y ${band.maxDaysPastDue} días de mora`;
  const previsión = `${(band.provisionRate * 100).toFixed(2).replace(/\.?0+$/, '')} %`;
  return `${band.gradeLabel}: ${mora}. Previsión exigida: ${previsión} de la exposición.`;
}

/** El catálogo derivado de la política ya resuelta. No inventa ninguna categoría. */
export function buildRatingScaleCatalog(resolved: ResolvedRatingPolicy): RatingScaleCatalog {
  const total = resolved.bands.length;
  return {
    policyCode: resolved.policy.policyCode,
    versionCode: resolved.policy.versionCode,
    grades: resolved.bands.map((band) => ({
      grade: band.grade,
      label: band.gradeLabel,
      severityRank: band.severityRank,
      minDaysPastDue: band.minDaysPastDue,
      maxDaysPastDue: band.maxDaysPastDue,
      provisionRate: band.provisionRate,
      tone: toneFor(band.severityRank, total),
      help: helpFor({
        gradeLabel: band.gradeLabel,
        minDaysPastDue: band.minDaysPastDue,
        maxDaysPastDue: band.maxDaysPastDue,
        provisionRate: band.provisionRate,
      }),
    })),
  };
}
