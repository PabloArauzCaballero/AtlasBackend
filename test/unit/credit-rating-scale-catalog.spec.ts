import { buildRatingScaleCatalog } from '../../src/modules/credit-rating/application/rating-scale-catalog.js';
import type { ResolvedRatingPolicy } from '../../src/modules/credit-rating/application/rating-policy.service.js';

/**
 * El catálogo de la escala de calificación.
 *
 * Existe porque la interfaz sabía enseñar la LETRA de un cliente y nada más: ni
 * su etiqueta, ni el tramo de mora que la define, ni la previsión que arrastra.
 * Una «C» en una tabla es un carácter; lo que hay detrás es el 20 % de la
 * exposición previsionada.
 *
 * Lo que se fija aquí es que el catálogo **se derive de la política** y no
 * declare ninguna escala propia. Es la diferencia entre un sistema extensible y
 * uno con la escala escrita a mano en dos sitios: el día que se apruebe una
 * versión nueva, la copia sigue pareciendo correcta y explica los criterios
 * anteriores sin que nada falle.
 */

/** La escala ASFI real, tal como la siembra la política de producción. */
const ASFI: ResolvedRatingPolicy = {
  policy: { policyCode: 'ASFI', versionCode: 'v1' },
  bands: [
    { grade: 'A', gradeLabel: 'Normal', severityRank: 0, minDaysPastDue: 0, maxDaysPastDue: 0, provisionRate: 0.01 },
    { grade: 'B', gradeLabel: 'Riesgo potencial', severityRank: 1, minDaysPastDue: 1, maxDaysPastDue: 30, provisionRate: 0.05 },
    { grade: 'C', gradeLabel: 'Deficiente', severityRank: 2, minDaysPastDue: 31, maxDaysPastDue: 60, provisionRate: 0.2 },
    { grade: 'D', gradeLabel: 'Dudoso', severityRank: 3, minDaysPastDue: 61, maxDaysPastDue: 90, provisionRate: 0.5 },
    { grade: 'E', gradeLabel: 'Pérdida', severityRank: 4, minDaysPastDue: 91, maxDaysPastDue: 180, provisionRate: 0.8 },
    { grade: 'F', gradeLabel: 'Pérdida irrecuperable', severityRank: 5, minDaysPastDue: 181, maxDaysPastDue: null, provisionRate: 1 },
  ],
} as unknown as ResolvedRatingPolicy;

/** Una escala comercial de tres categorías, para probar que nada está fijado a seis. */
const COMERCIAL: ResolvedRatingPolicy = {
  policy: { policyCode: 'COMERCIAL', versionCode: 'v1' },
  bands: [
    { grade: 'AAA', gradeLabel: 'Preferente', severityRank: 0, minDaysPastDue: 0, maxDaysPastDue: 0, provisionRate: 0.005 },
    { grade: 'AA', gradeLabel: 'Bueno', severityRank: 1, minDaysPastDue: 1, maxDaysPastDue: 15, provisionRate: 0.02 },
    { grade: 'A', gradeLabel: 'Aceptable', severityRank: 2, minDaysPastDue: 16, maxDaysPastDue: null, provisionRate: 0.06 },
  ],
} as unknown as ResolvedRatingPolicy;

describe('el catálogo sale de la política, no de una lista propia', () => {
  it('publica exactamente las categorías de la escala vigente', () => {
    const catalogo = buildRatingScaleCatalog(ASFI);
    expect(catalogo.grades.map((g) => g.grade)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(catalogo.policyCode).toBe('ASFI');
    expect(catalogo.versionCode).toBe('v1');
  });

  it('funciona igual con una escala de OTRO tamaño, sin tocar código', () => {
    // Ésta es la prueba de extensibilidad que pide el requisito: si el negocio
    // aprueba una escala comercial de tres categorías, se sirve sola.
    const catalogo = buildRatingScaleCatalog(COMERCIAL);
    expect(catalogo.grades.map((g) => g.grade)).toEqual(['AAA', 'AA', 'A']);
  });
});

describe('el tono se deriva de la POSICIÓN, nunca de la letra', () => {
  it('en la escala de seis, la mejor va en verde y la peor en rojo', () => {
    const grades = buildRatingScaleCatalog(ASFI).grades;
    expect(grades[0].tone).toBe('success');
    expect(grades[grades.length - 1].tone).toBe('critical');
  });

  it('en la escala de tres, la mejor sigue en verde y la peor en rojo', () => {
    /*
     * Aquí está el defecto que esto evita: un mapa por letra daría a «A» el
     * verde de la escala ASFI, cuando en la comercial «A» es la PEOR de las
     * tres. La misma letra significa cosas opuestas en dos escalas, así que el
     * color no puede depender de ella.
     */
    const grades = buildRatingScaleCatalog(COMERCIAL).grades;
    expect(grades[0].tone).toBe('success');
    expect(grades[2].tone).toBe('critical');
    expect(grades[2].grade).toBe('A');
  });

  it('una escala de una sola categoría no revienta ni la deja sin tono', () => {
    const unica = buildRatingScaleCatalog({
      ...ASFI,
      bands: [ASFI.bands[0]],
    } as ResolvedRatingPolicy);
    expect(unica.grades[0].tone).toBe('success');
  });
});

describe('la explicación dice lo que hace falta para entender la categoría', () => {
  it('nombra el tramo de mora y la previsión exigida', () => {
    const c = buildRatingScaleCatalog(ASFI).grades[2];
    expect(c.help).toContain('Deficiente');
    expect(c.help).toContain('entre 31 y 60 días');
    expect(c.help).toContain('20 %');
  });

  it('la última banda se lee como abierta, no como un rango sin fin', () => {
    const f = buildRatingScaleCatalog(ASFI).grades[5];
    expect(f.help).toContain('desde 181 días');
    expect(f.help).toContain('100 %');
  });

  it('una banda de un solo día no dice «entre 0 y 0»', () => {
    const a = buildRatingScaleCatalog(ASFI).grades[0];
    expect(a.help).toContain('0 días de mora');
    expect(a.help).not.toContain('entre');
  });
});
