import { describe, expect, it } from '@jest/globals';
import { evaluateExpression, evaluatePredicate } from '../../../src/modules/risk/application/risk-rule-expression.js';
import { PolicyRule, evaluateRuleset } from '../../../src/modules/risk/application/risk-ruleset-evaluator.js';

/**
 * Motor de política de riesgo.
 *
 * El servicio evaluaba con seis constantes escritas a mano: cambiar un umbral era un despliegue. Las
 * tablas de ruleset versionado existían desde el inicio y nadie las leía. Estos tests fijan el
 * comportamiento del DSL que los rulesets ya sembrados usan y las decisiones que su combinación
 * produce.
 */
describe('evaluatePredicate', () => {
  const features = { income: 5000, ratio: 0.35, flagged: true, tier: 'gold' };

  it('compara numéricamente con gte/gt/lte/lt', () => {
    expect(evaluatePredicate({ field: 'income', gte: 5000 }, features)).toBe(true);
    expect(evaluatePredicate({ field: 'income', gt: 5000 }, features)).toBe(false);
    expect(evaluatePredicate({ field: 'ratio', lte: 0.4 }, features)).toBe(true);
    expect(evaluatePredicate({ field: 'ratio', lt: 0.35 }, features)).toBe(false);
  });

  it('compara por igualdad y pertenencia, incluidos booleanos y strings', () => {
    expect(evaluatePredicate({ field: 'flagged', equals: true }, features)).toBe(true);
    expect(evaluatePredicate({ field: 'tier', equals: 'gold' }, features)).toBe(true);
    expect(evaluatePredicate({ field: 'tier', in: ['silver', 'gold'] }, features)).toBe(true);
    expect(evaluatePredicate({ field: 'tier', in: ['silver'] }, features)).toBe(false);
  });

  it('`missing` distingue ausente de presente, y trata NaN como ausente', () => {
    expect(evaluatePredicate({ field: 'sin_dato', missing: true }, features)).toBe(true);
    expect(evaluatePredicate({ field: 'income', missing: true }, features)).toBe(false);
    expect(evaluatePredicate({ field: 'income', missing: false }, features)).toBe(true);
    expect(evaluatePredicate({ field: 'roto', missing: true }, { roto: Number.NaN })).toBe(true);
    expect(evaluatePredicate({ field: 'nulo', missing: true }, { nulo: null })).toBe(true);
  });

  /**
   * La decisión más importante del evaluador: sin ella, una regla de bloqueo como "ingreso residual
   * ≤ 0" se dispararía con `undefined <= 0` en toda evaluación sin datos, y el sistema bloquearía
   * clientes por falta de información en vez de pedirla.
   */
  it('un predicado sobre una feature ausente es FALSO, no verdadero', () => {
    expect(evaluatePredicate({ field: 'sin_dato', lte: 0 }, features)).toBe(false);
    expect(evaluatePredicate({ field: 'sin_dato', gte: 0 }, features)).toBe(false);
    expect(evaluatePredicate({ field: 'sin_dato', equals: 0 }, features)).toBe(false);
  });

  /** Comparar un booleano o un string con `>=` produciría coerciones silenciosas. */
  it('no compara numéricamente valores que no son números', () => {
    expect(evaluatePredicate({ field: 'flagged', gte: 0 }, features)).toBe(false);
    expect(evaluatePredicate({ field: 'tier', lte: 10 }, features)).toBe(false);
  });
});

describe('evaluateExpression', () => {
  const features = { a: 1, b: 10 };

  it('`all` exige que se cumplan todas y `any` que se cumpla alguna', () => {
    expect(
      evaluateExpression(
        {
          all: [
            { field: 'a', equals: 1 },
            { field: 'b', gte: 10 },
          ],
        },
        features,
      ),
    ).toBe(true);
    expect(
      evaluateExpression(
        {
          all: [
            { field: 'a', equals: 1 },
            { field: 'b', gte: 99 },
          ],
        },
        features,
      ),
    ).toBe(false);
    expect(
      evaluateExpression(
        {
          any: [
            { field: 'a', equals: 99 },
            { field: 'b', gte: 10 },
          ],
        },
        features,
      ),
    ).toBe(true);
    expect(evaluateExpression({ any: [{ field: 'a', equals: 99 }] }, features)).toBe(false);
  });

  it('soporta `not` y el anidamiento de grupos', () => {
    expect(evaluateExpression({ not: { field: 'a', equals: 99 } }, features)).toBe(true);
    expect(evaluateExpression({ all: [{ any: [{ field: 'a', equals: 1 }] }, { not: { field: 'b', lt: 5 } }] }, features)).toBe(true);
  });

  /**
   * Tratar una expresión irreconocible como verdadera haría que un error de configuración bloqueara
   * clientes en masa sin que nadie lo notara.
   */
  it('una expresión vacía, nula o irreconocible NO se dispara', () => {
    expect(evaluateExpression(null, features)).toBe(false);
    expect(evaluateExpression({}, features)).toBe(false);
    expect(evaluateExpression({ all: [] }, features)).toBe(false);
    expect(evaluateExpression({ any: [] }, features)).toBe(false);
    expect(evaluateExpression({ operadorInventado: 1 }, features)).toBe(false);
    expect(evaluateExpression('texto suelto', features)).toBe(false);
  });
});

describe('evaluateRuleset', () => {
  function rule(overrides: Partial<PolicyRule> & { ruleCode: string }): PolicyRule {
    return {
      ruleName: null,
      riskDimension: 'capacity',
      severity: 'high',
      actionCode: 'MANUAL_REVIEW',
      reasonCode: overrides.ruleCode.toUpperCase(),
      isHardStop: false,
      expression: { all: [{ field: 'score', gte: 0 }] },
      ...overrides,
    };
  }

  it('sin reglas disparadas la decisión es favorable', () => {
    const result = evaluateRuleset([rule({ ruleCode: 'r1', expression: { all: [{ field: 'score', gte: 999 }] } })], { score: 10 });
    expect(result.decision).toBe('approved_for_next_step');
    expect(result.firedRules).toEqual([]);
    expect(result.reasons).toEqual(['no_policy_rule_fired']);
    expect(result.evaluatedRuleCount).toBe(1);
  });

  it('una regla de revisión escala a revisión manual', () => {
    const result = evaluateRuleset([rule({ ruleCode: 'revisar' })], { score: 10 });
    expect(result.decision).toBe('manual_review_required');
    expect(result.reasons).toEqual(['REVISAR']);
  });

  /** Basta UNA regla de bloqueo: la precedencia es por severidad, no por orden de aparición. */
  it('una sola regla de bloqueo manda sobre cualquier cantidad de revisiones', () => {
    const rules = [
      rule({ ruleCode: 'revisar_1' }),
      rule({ ruleCode: 'bloquear', actionCode: 'BLOCK', isHardStop: true }),
      rule({ ruleCode: 'revisar_2' }),
    ];
    expect(evaluateRuleset(rules, { score: 10 }).decision).toBe('blocked');
    // Y el resultado no depende del orden de las filas del catálogo.
    expect(evaluateRuleset([...rules].reverse(), { score: 10 }).decision).toBe('blocked');
  });

  it('reporta cada regla disparada con su dimensión, severidad y motivo', () => {
    const result = evaluateRuleset([rule({ ruleCode: 'r1', riskDimension: 'indebtedness', severity: 'critical' })], { score: 1 });
    expect(result.firedRules).toEqual([
      {
        ruleCode: 'r1',
        riskDimension: 'indebtedness',
        severity: 'critical',
        actionCode: 'MANUAL_REVIEW',
        reasonCode: 'R1',
        isHardStop: false,
      },
    ]);
  });

  /** Descartar una regla mal configurada en silencio la convertiría en una aprobación. */
  it('una acción desconocida se trata como revisión manual, no se ignora', () => {
    const result = evaluateRuleset([rule({ ruleCode: 'raro', actionCode: 'ACCION_INVENTADA' })], { score: 1 });
    expect(result.decision).toBe('manual_review_required');
    expect(result.firedRules[0].actionCode).toBe('MANUAL_REVIEW');
  });

  it('`is_hard_stop` desalineado de la acción resuelve por lo más restrictivo', () => {
    const byAction = evaluateRuleset([rule({ ruleCode: 'a', actionCode: 'BLOCK', isHardStop: false })], { score: 1 });
    expect(byAction.firedRules[0].isHardStop).toBe(true);

    const byFlag = evaluateRuleset([rule({ ruleCode: 'b', actionCode: 'MANUAL_REVIEW', isHardStop: true })], { score: 1 });
    expect(byFlag.firedRules[0].isHardStop).toBe(true);
  });

  it('una regla APPROVE que se dispara no escala nada', () => {
    const result = evaluateRuleset([rule({ ruleCode: 'ok', actionCode: 'APPROVE' })], { score: 1 });
    expect(result.decision).toBe('approved_for_next_step');
    expect(result.firedRules).toHaveLength(1);
  });

  it('cae al reasonCode del propio código de regla cuando la fila no declara motivo', () => {
    const result = evaluateRuleset([{ ...rule({ ruleCode: 'sin_motivo' }), reasonCode: null }], { score: 1 });
    expect(result.reasons).toEqual(['sin_motivo']);
  });
});
