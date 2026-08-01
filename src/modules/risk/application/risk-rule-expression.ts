/**
 * @file Evaluador puro del DSL de expresiones de `risk_policy_rules.expression_json`.
 * @business Permite que cambiar un umbral de riesgo sea un cambio de configuración auditado y no un
 * despliegue de código.
 * @system interpreta el mismo formato que ya emiten los seeders de política de riesgo, sin base de
 * datos ni dependencias.
 */

/** Valores de feature que una regla puede leer. `undefined` = feature ausente. */
export type FeatureMap = Readonly<Record<string, number | boolean | string | null | undefined>>;

/**
 * Predicado sobre una feature. Es el vocabulario que los rulesets ya sembrados usan:
 * `missing`, `equals`, `gte`, `gt`, `lte`, `lt`, `in`.
 */
export type RulePredicate = {
  field: string;
  missing?: boolean;
  equals?: number | boolean | string;
  gte?: number;
  gt?: number;
  lte?: number;
  lt?: number;
  in?: ReadonlyArray<number | boolean | string>;
};

export type RuleExpression = { all?: unknown[]; any?: unknown[]; not?: unknown } | RulePredicate;

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value));
}

function asPredicate(node: unknown): RulePredicate | null {
  if (typeof node !== 'object' || node === null) return null;
  const candidate = node as RulePredicate;
  return typeof candidate.field === 'string' ? candidate : null;
}

/**
 * Evalúa un predicado.
 *
 * Un predicado sobre una feature ausente es FALSO, salvo que el predicado sea justamente
 * `missing: true`. Es la decisión importante del evaluador: sin ella, una regla de bloqueo del tipo
 * "ingreso residual ≤ 0" se dispararía con `undefined <= 0` en toda evaluación sin datos, y el
 * sistema bloquearía clientes por falta de información en vez de pedirla.
 */
export function evaluatePredicate(predicate: RulePredicate, features: FeatureMap): boolean {
  const value = features[predicate.field];

  if (predicate.missing !== undefined) return predicate.missing === isMissing(value);
  if (isMissing(value)) return false;

  if (predicate.equals !== undefined) return value === predicate.equals;
  if (predicate.in !== undefined) return predicate.in.includes(value as number | boolean | string);

  // Las comparaciones son estrictamente numéricas: comparar un booleano o un string con `>=`
  // produciría coerciones silenciosas y decisiones de riesgo inexplicables.
  if (typeof value !== 'number') return false;
  if (predicate.gte !== undefined && !(value >= predicate.gte)) return false;
  if (predicate.gt !== undefined && !(value > predicate.gt)) return false;
  if (predicate.lte !== undefined && !(value <= predicate.lte)) return false;
  if (predicate.lt !== undefined && !(value < predicate.lt)) return false;

  const hasComparison =
    predicate.gte !== undefined || predicate.gt !== undefined || predicate.lte !== undefined || predicate.lt !== undefined;
  return hasComparison;
}

/**
 * Evalúa una expresión completa.
 *
 * Una expresión vacía o irreconocible devuelve `false`: una regla que no se entiende NO se dispara.
 * La alternativa —tratarla como verdadera— haría que un error de configuración bloqueara clientes en
 * masa sin que nadie lo notara.
 */
export function evaluateExpression(expression: unknown, features: FeatureMap): boolean {
  if (typeof expression !== 'object' || expression === null) return false;

  const node = expression as { all?: unknown[]; any?: unknown[]; not?: unknown };

  if (Array.isArray(node.all)) {
    // `all` vacío no es "todo se cumple": es una regla sin condiciones, y no debe dispararse.
    return node.all.length > 0 && node.all.every((child) => evaluateExpression(child, features));
  }
  if (Array.isArray(node.any)) {
    return node.any.some((child) => evaluateExpression(child, features));
  }
  if (node.not !== undefined) {
    return !evaluateExpression(node.not, features);
  }

  const predicate = asPredicate(expression);
  return predicate ? evaluatePredicate(predicate, features) : false;
}
