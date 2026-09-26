/**
 * @file Utilidad pura del dominio: resuelve bindings y condiciones de una receta.
 * @business Esta pieza garantiza que el cuerpo que se envía es el que la receta declaró, con sus
 *   tipos, y que una referencia ausente se detiene ANTES de gastar una petición.
 * @system sin dependencias de framework; se prueba con objetos planos.
 *
 * Corrige dos defectos del runner del navegador (H08): los marcadores no resueltos viajaban como
 * texto literal `{{…}}`, y toda sustitución convertía a cadena, así que un array de consentimientos
 * o un ingreso numérico llegaban como `"[object Object]"` o `"4500"`.
 */
import type { Binding, Condition, JsonValue, JourneyPath } from './journey-recipe.types.js';

export type BindingScope = Record<string, unknown>;

export class BindingUnresolvedError extends Error {
  constructor(readonly path: JourneyPath) {
    super(`BINDING_UNRESOLVED:${path}`);
    this.name = 'BindingUnresolvedError';
  }
}

const MISSING = Symbol('missing');
const TEMPLATE = /\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g;

/** `a.b[0].c` o `a.b.0.c` → valor, o `MISSING`. Un `null` presente NO es ausencia. */
export function lookup(scope: BindingScope, path: JourneyPath): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let current: unknown = scope;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return MISSING;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return MISSING;
    current = (current as Record<string, unknown>)[segment];
  }
  return current === undefined ? MISSING : current;
}

export function has(scope: BindingScope, path: JourneyPath): boolean {
  return lookup(scope, path) !== MISSING;
}

/** Lee una ruta que DEBE existir. */
export function read(scope: BindingScope, path: JourneyPath): unknown {
  const value = lookup(scope, path);
  if (value === MISSING) throw new BindingUnresolvedError(path);
  return value;
}

/** Lee una ruta que puede faltar; `undefined` significa ausencia. */
export function readOptional(scope: BindingScope, path: JourneyPath): unknown {
  const value = lookup(scope, path);
  return value === MISSING ? undefined : value;
}

function isRef(value: unknown): value is { $ref: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { $ref?: unknown }).$ref === 'string'
  );
}

/** Interpola `{{ruta}}` dentro de una cadena. Un objeto dentro de una cadena es un error de receta. */
export function interpolate(template: string, scope: BindingScope): string {
  return template.replace(TEMPLATE, (_match, path: string) => {
    const value = read(scope, path);
    if (value !== null && typeof value === 'object') throw new BindingUnresolvedError(`${path} (objeto dentro de una cadena)`);
    return String(value);
  });
}

/** Resuelve un binding completo. El resultado es JSON puro, listo para `JSON.stringify`. */
export function resolveBinding(binding: Binding | undefined, scope: BindingScope): JsonValue | undefined {
  if (binding === undefined) return undefined;
  if (isRef(binding)) return read(scope, binding.$ref) as JsonValue;
  if (typeof binding === 'string') return interpolate(binding, scope);
  if (Array.isArray(binding)) return binding.map((entry) => resolveBinding(entry, scope) as JsonValue);
  if (binding !== null && typeof binding === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(binding)) {
      const resolved = resolveBinding(entry as Binding, scope);
      if (resolved !== undefined) out[key] = resolved;
    }
    return out;
  }
  return binding;
}

/** Todas las rutas que un binding necesita. El preflight las usa para bloquear sin enviar nada. */
export function referencedPaths(binding: Binding | undefined): string[] {
  if (binding === undefined || binding === null) return [];
  if (isRef(binding)) return [binding.$ref];
  if (typeof binding === 'string') return [...binding.matchAll(TEMPLATE)].map((match) => match[1]);
  if (Array.isArray(binding)) return binding.flatMap((entry) => referencedPaths(entry));
  if (typeof binding === 'object') return Object.values(binding).flatMap((entry) => referencedPaths(entry as Binding));
  return [];
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left as object);
  const rightKeys = Object.keys(right as object);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

export { deepEqual };

export function evaluateCondition(condition: Condition, scope: BindingScope): boolean {
  switch (condition.kind) {
    case 'equals':
      return has(scope, condition.path) && deepEqual(lookup(scope, condition.path), condition.value);
    case 'exists':
      return has(scope, condition.path);
    case 'truthy':
      return Boolean(readOptional(scope, condition.path));
    case 'not':
      return !evaluateCondition(condition.condition, scope);
    case 'all':
      return condition.conditions.every((entry) => evaluateCondition(entry, scope));
    case 'any':
      return condition.conditions.some((entry) => evaluateCondition(entry, scope));
  }
}

/** Rutas que una condición consulta. Condicionar sobre algo que ningún paso produce es un error. */
export function conditionPaths(condition: Condition): string[] {
  switch (condition.kind) {
    case 'not':
      return conditionPaths(condition.condition);
    case 'all':
    case 'any':
      return condition.conditions.flatMap(conditionPaths);
    default:
      return [condition.path];
  }
}
