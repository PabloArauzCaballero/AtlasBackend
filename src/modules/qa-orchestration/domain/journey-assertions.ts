/**
 * @file Utilidad pura del dominio: el oráculo de un paso QA.
 * @business Esta pieza decide si un paso pasó por lo que el negocio espera, no porque el HTTP fue 2xx.
 * @system transporte primero, luego código HTTP contra el contrato, luego aserciones del catálogo.
 *
 * Corrige H04: el runner del navegador calculaba `passed = dryRun ? true : runResult.ok`, así que
 * un 200 con el cliente de otra persona pasaba, un 422 esperado fallaba y un dry-run aprobaba.
 * Aquí un 2xx sin aserciones satisfechas es FAILED, y un 4xx declarado en el contrato con su código
 * de negocio correcto es PASSED: un rechazo correcto es una prueba aprobada.
 */
import type { Assertion, Expectation, ExpectationBranch, JsonValue } from './journey-recipe.types.js';
import { BindingUnresolvedError, deepEqual, evaluateCondition, readOptional, resolveBinding, type BindingScope } from './typed-bindings.js';

export type AssertionFailure = {
  code:
    | 'TRANSPORT_ERROR'
    | 'STATUS_UNEXPECTED'
    | 'ASSERTION_EXISTS_FAILED'
    | 'ASSERTION_TYPE_FAILED'
    | 'ASSERTION_EQUALS_FAILED'
    | 'ASSERTION_ONE_OF_FAILED'
    | 'ASSERTION_CONTAINS_FAILED'
    | 'ASSERTION_ARRAY_FAILED'
    | 'OWNERSHIP_MISMATCH'
    | 'ERROR_CODE_MISMATCH'
    | 'CONSISTENCY_MISMATCH'
    | 'BINDING_UNRESOLVED';
  message: string;
  path?: string;
};

export type StepVerdict = {
  status: 'PASSED' | 'FAILED' | 'INDETERMINATE';
  failures: AssertionFailure[];
  /** Rama de expectativa aplicada, para que el informe diga "se esperaba rechazo". */
  branch: string;
};

export type ObservedResponse = { status: number; body: unknown } | { status: null; transportError: string };

const ROOTS = new Set(['persona', 'resources', 'fixtures', 'run', 'response', 'session', 'context']);

/** Una ruta de aserción sin raíz se lee sobre la respuesta: `data.customerId` ≡ `response.data.customerId`. */
function rooted(path: string): string {
  const root = path.split(/[.[]/)[0];
  return ROOTS.has(root) ? path : `response.${path}`;
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function show(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return 'ausente';
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** Código de error de negocio de un cuerpo Atlas `{ error: { code } }`. */
export function errorCodeOf(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

type Checked<K extends Assertion['kind']> = (
  assertion: Extract<Assertion, { kind: K }>,
  actual: unknown,
  scope: BindingScope,
  path: string,
) => AssertionFailure | null;

const fail = (code: AssertionFailure['code'], message: string, path?: string): AssertionFailure => ({ code, message, path });

function arrayLengthFailure(
  assertion: Extract<Assertion, { kind: 'arrayLength' }>,
  actual: unknown,
  path: string,
): AssertionFailure | null {
  if (!Array.isArray(actual)) return fail('ASSERTION_ARRAY_FAILED', `${assertion.path} no es una lista`, path);
  if (assertion.equals !== undefined && actual.length !== assertion.equals) {
    return fail('ASSERTION_ARRAY_FAILED', `${assertion.path} tiene ${actual.length} elementos; se esperaban ${assertion.equals}`, path);
  }
  if (assertion.min !== undefined && actual.length < assertion.min) {
    return fail('ASSERTION_ARRAY_FAILED', `${assertion.path} tiene ${actual.length} elementos; mínimo ${assertion.min}`, path);
  }
  return null;
}

function hasFieldEqual(entry: unknown, field: string, expected: unknown): boolean {
  return entry !== null && typeof entry === 'object' && deepEqual((entry as Record<string, JsonValue>)[field], expected);
}

/** Un evaluador por tipo del catálogo: añadir un tipo obliga a añadir aquí su evaluador. */
const CHECKS: { [K in Exclude<Assertion['kind'], 'errorCode'>]: Checked<K> } = {
  exists: (assertion, actual, _scope, path) =>
    actual === undefined ? fail('ASSERTION_EXISTS_FAILED', `falta ${assertion.path}`, path) : null,
  type: (assertion, actual, _scope, path) =>
    typeOf(actual) === assertion.type
      ? null
      : fail('ASSERTION_TYPE_FAILED', `${assertion.path} es ${typeOf(actual)} y debía ser ${assertion.type}`, path),
  equals: (assertion, actual, scope, path) => {
    const expected = resolveBinding(assertion.expected, scope);
    return deepEqual(actual, expected)
      ? null
      : fail('ASSERTION_EQUALS_FAILED', `${assertion.path} = ${show(actual)}; se esperaba ${show(expected)}`, path);
  },
  resourceOwner: (assertion, actual, scope, path) => {
    const expected = resolveBinding(assertion.expected, scope);
    return deepEqual(actual, expected)
      ? null
      : fail(
          'OWNERSHIP_MISMATCH',
          `${assertion.path} pertenece a ${show(actual)} y no a ${show(expected)}: sesión o recurso de otra persona`,
          path,
        );
  },
  sameAs: (assertion, actual, scope, path) => {
    const expected = readOptional(scope, assertion.ref);
    return deepEqual(actual, expected)
      ? null
      : fail('CONSISTENCY_MISMATCH', `${assertion.path} = ${show(actual)} contradice ${assertion.ref} = ${show(expected)}`, path);
  },
  oneOf: (assertion, actual, _scope, path) =>
    assertion.values.some((value) => deepEqual(actual, value))
      ? null
      : fail('ASSERTION_ONE_OF_FAILED', `${assertion.path} = ${show(actual)} no está en ${show(assertion.values)}`, path),
  contains: (assertion, actual, _scope, path) =>
    Array.isArray(actual) && actual.some((entry) => deepEqual(entry, assertion.value))
      ? null
      : fail('ASSERTION_CONTAINS_FAILED', `${assertion.path} no contiene ${show(assertion.value)}`, path),
  arrayNonEmpty: (assertion, actual, _scope, path) =>
    Array.isArray(actual) && actual.length > 0
      ? null
      : fail('ASSERTION_ARRAY_FAILED', `${assertion.path} debía ser una lista no vacía`, path),
  arrayLength: (assertion, actual, _scope, path) => arrayLengthFailure(assertion, actual, path),
  arrayContainsWhere: (assertion, actual, scope, path) => {
    const expected = resolveBinding(assertion.expected, scope);
    return Array.isArray(actual) && actual.some((entry) => hasFieldEqual(entry, assertion.field, expected))
      ? null
      : fail('ASSERTION_CONTAINS_FAILED', `${assertion.path} no tiene un elemento con ${assertion.field} = ${show(expected)}`, path);
  },
};

function check(assertion: Assertion, scope: BindingScope): AssertionFailure | null {
  if (assertion.kind === 'errorCode') {
    const actual = errorCodeOf(scope.response);
    return actual === assertion.code
      ? null
      : fail('ERROR_CODE_MISMATCH', `se esperaba el error ${assertion.code} y llegó ${actual ?? 'ninguno'}`);
  }
  const path = rooted(assertion.path);
  const evaluate = CHECKS[assertion.kind] as Checked<typeof assertion.kind>;
  return evaluate(assertion as never, readOptional(scope, path), scope, path);
}

/** Elige la rama cuya condición se cumple con el estado previo al envío; si ninguna, la base. */
export function selectExpectation(
  base: Expectation,
  branches: ExpectationBranch[] | undefined,
  scope: BindingScope,
): Expectation & { label: string } {
  for (const branch of branches ?? []) {
    if (evaluateCondition(branch.when, scope)) return branch;
  }
  return { ...base, label: 'default' };
}

export function evaluateQaStep(input: {
  expected: Expectation & { label?: string };
  response: ObservedResponse;
  scope?: BindingScope;
}): StepVerdict {
  const branch = input.expected.label ?? 'default';
  if (input.response.status === null) {
    // Sin respuesta no se sabe si el efecto ocurrió: INDETERMINATE, nunca FAILED ni PASSED.
    return { status: 'INDETERMINATE', failures: [{ code: 'TRANSPORT_ERROR', message: input.response.transportError }], branch };
  }
  const { status, body } = input.response;
  if (!input.expected.status.includes(status)) {
    const code = errorCodeOf(body);
    return {
      status: 'FAILED',
      failures: [
        { code: 'STATUS_UNEXPECTED', message: `HTTP ${status}${code ? ` ${code}` : ''}; se esperaba ${input.expected.status.join('|')}` },
      ],
      branch,
    };
  }
  const scope: BindingScope = { ...(input.scope ?? {}), response: body };
  const failures: AssertionFailure[] = [];
  for (const assertion of input.expected.assertions ?? []) {
    try {
      const failure = check(assertion, scope);
      if (failure) failures.push(failure);
    } catch (error) {
      if (!(error instanceof BindingUnresolvedError)) throw error;
      failures.push({ code: 'BINDING_UNRESOLVED', message: error.message, path: error.path });
    }
  }
  return { status: failures.length === 0 ? 'PASSED' : 'FAILED', failures, branch };
}
