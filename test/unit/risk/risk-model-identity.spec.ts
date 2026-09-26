/**
 * @file Verifica qué modelo se publica según el escalón que decidió el riesgo de onboarding.
 * @business El modelo publicado es el que DE VERDAD decidió; publicar la heurística sobre una ejecución del Motor falsea el origen.
 * @system Ejercita `resolveModelIdentity` (C-5).
 */
import { describe, expect, it } from '@jest/globals';
import { resolveModelIdentity } from '../../../src/modules/risk/application/risk-model-identity.js';

describe('resolveModelIdentity', () => {
  it('una decisión del Motor publica el artefacto del Motor con la versión aplicada', () => {
    const identity = resolveModelIdentity({ decisionSource: 'decision_engine', rulesetVersionCode: '4001' });

    expect(identity.modelVersion).toBe('4001');
    expect(identity.modelCode).not.toBe('risk_heuristic_v0');
  });

  it('un NO_DECISION del Motor también es el Motor: respondió, sólo que sin veredicto', () => {
    const noDecision = resolveModelIdentity({ decisionSource: 'engine_no_decision', rulesetVersionCode: '4001' });
    const decided = resolveModelIdentity({ decisionSource: 'decision_engine', rulesetVersionCode: '4001' });

    // Antes caía en la rama heurística: la ejecución real del artefacto se publicaba con otro modelo.
    expect(noDecision).toEqual(decided);
  });

  it('la heurística de arranque y el ruleset local conservan la identidad de la heurística', () => {
    const heuristic = resolveModelIdentity({ decisionSource: 'heuristic_v0', rulesetVersionCode: 'x' });
    const ruleset = resolveModelIdentity({ decisionSource: 'ruleset', rulesetVersionCode: 'v3' });

    expect(heuristic.modelCode).toBe('risk_heuristic_v0');
    expect(ruleset.modelCode).toBe('risk_heuristic_v0');
  });
});
