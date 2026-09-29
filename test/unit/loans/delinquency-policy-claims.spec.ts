/**
 * @file La política de mora publicada no afirma lo que el sistema no hace.
 * @business La v1 prometía avisos, interés penal, bloqueo de compras y reporte a la central de
 *   riesgo; la v2 describe sólo lo que ocurre. Esta prueba mira el texto EXACTO que publica la
 *   migración de la v2, y comprueba en negativo que el detector sí caza las frases de la v1.
 * @system unidad pura sobre `findUnbackedClaims` y las constantes de la migración.
 */
import { describe, expect, it } from '@jest/globals';
import { DELINQUENCY_POLICY_V2 } from '../../../src/database/migrations/20260929200000-publish-delinquency-policy-v2.js';
import { findUnbackedClaims, UNBACKED_DELINQUENCY_CLAIMS } from '../../../src/modules/loans/domain/delinquency-policy-claims.js';

/** Frases literales de la v1 (`20260821060000-create-delinquency-policies.ts`). */
const V1_SENTENCES = {
  recordatorio: 'No se cobra interés penal. Se envía un recordatorio.',
  interesPenal: 'Corre interés penal sobre el capital vencido, contado desde el día 1 del atraso.',
  compras: 'Se suspende la posibilidad de nuevas compras hasta regularizar.',
  central: 'El caso pasa a cobranza y se reporta a la Central de Información Crediticia.',
  cuerpo:
    'Pagando la cuota vencida más el interés penal acumulado. Al quedar al día se levantan de inmediato las\nrestricciones de compra.',
};

function policyWith(detail: string, body = '') {
  return { title: 'Política', summary: 'Resumen', bodyMarkdown: body, source: { reference: null }, stages: [{ label: 'Tramo', detail }] };
}

describe('política de mora publicada', () => {
  it('la v2 no contiene ninguna afirmación sin respaldo', () => {
    expect(findUnbackedClaims(DELINQUENCY_POLICY_V2)).toEqual([]);
  });

  it('la v2 declara sus tramos sobre los mismos cortes que `bucketForDaysPastDue`', () => {
    expect(DELINQUENCY_POLICY_V2.stages.map((stage) => [stage.fromDay, stage.toDay])).toEqual([
      [null, 0],
      [1, 29],
      [30, 59],
      [60, 89],
      [90, null],
    ]);
  });

  it.each([
    ['se envía un recordatorio', V1_SENTENCES.recordatorio],
    ['interés penal o moratorio', V1_SENTENCES.interesPenal],
    ['se suspenden las compras', V1_SENTENCES.compras],
    ['reporte a una central de riesgo', V1_SENTENCES.central],
    ['el caso pasa a cobranza', V1_SENTENCES.central],
  ])('en negativo: caza «%s» en el texto de la v1', (claim, sentence) => {
    const claims = findUnbackedClaims(policyWith(sentence)).map((finding) => finding.claim);
    expect(claims).toContain(claim);
  });

  it('en negativo: caza la frase aunque el markdown la parta en dos líneas', () => {
    const claims = findUnbackedClaims(policyWith('', V1_SENTENCES.cuerpo)).map((finding) => finding.claim);
    expect(claims).toEqual(expect.arrayContaining(['interés penal o moratorio', 'se suspenden las compras']));
  });

  it('mira también el título, el resumen, la fuente y la etiqueta del tramo', () => {
    const findings = findUnbackedClaims({
      title: 'Interés moratorio',
      summary: 'Te avisamos antes de cada cuota.',
      bodyMarkdown: '',
      source: { reference: 'Reporte a la CIC' },
      stages: [{ label: 'Bloqueo de compras', detail: 42 }],
    });
    expect(findings.map((finding) => finding.claim).sort()).toEqual(
      ['interés penal o moratorio', 'se envía un recordatorio', 'reporte a una central de riesgo', 'se suspenden las compras'].sort(),
    );
  });

  it('cada afirmación prohibida dice por qué', () => {
    for (const entry of UNBACKED_DELINQUENCY_CLAIMS) expect(entry.why.length).toBeGreaterThan(20);
  });
});
