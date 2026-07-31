import { jest } from '@jest/globals';

/**
 * Fábricas de mocks "sueltos" para dependencias que se inyectan con `as never`.
 *
 * Motivo: `jest.fn()` de `@jest/globals` se infiere como `(...args: unknown[]) => unknown`. Como ese
 * retorno no es una promesa, TypeScript colapsa el parámetro de `mockResolvedValue()` a `never` y
 * CUALQUIER valor falla el type-check con "Argument of type X is not assignable to parameter of type
 * 'never'". El repo venía tapando eso con un `as never` por línea; declarar el contrato una sola vez
 * aquí elimina cientos de castings y, de paso, deja `.mock.calls[i][j]` como `unknown` en vez de un
 * tupla vacía, que era el origen de los errores "Tuple type '[]' has no element at index '0'".
 *
 * No tipan el contrato real de la dependencia a propósito: estos mocks se pasan al servicio bajo
 * prueba con `as never`, así que su firma no aporta seguridad; lo que aporta es que el spec compile
 * sin ruido. Para un doble de prueba con contrato real, tipa `jest.fn<TuFirma>()` directamente.
 */
type LooseAsyncFn = (...args: unknown[]) => Promise<unknown>;
type LooseSyncFn = (...args: unknown[]) => unknown;

/** Mock asíncrono: `mockResolvedValue(cualquierCosa)` compila sin casting. */
export function asyncMock() {
  return jest.fn<LooseAsyncFn>();
}

/**
 * Tipo del mock que devuelve `asyncMock()`. Úsalo en anotaciones y tipos mapeados
 * (`{ [K in keyof Repo]: AsyncMock }`) en vez de `jest.Mock`: ese último resuelve a
 * `Mock<UnknownFunction>` y vuelve a colapsar `mockResolvedValue()` a `never`.
 */
export type AsyncMock = ReturnType<typeof asyncMock>;

/** Mock síncrono: `mockReturnValue(cualquierCosa)` compila sin casting. */
export function syncMock() {
  return jest.fn<LooseSyncFn>();
}

/**
 * Argumento `argIndex` de la llamada `callIndex` de un mock, tipado por el spec.
 *
 * Reemplaza el acceso directo `(model.findAll as jest.Mock).mock.calls[0][0].where`, que no compila
 * porque el argumento es `unknown`: la aserción de tipo tiene que ocurrir ANTES de leer la propiedad.
 */
/**
 * Forma laxa para inspeccionar el argumento de un mock sin re-declarar el contrato completo.
 *
 * Es recursiva y admite índice por símbolo a propósito: los `where` de Sequelize anidan objetos y
 * usan claves `Op.or`/`Op.ne`, y con `Record<string, unknown>` cada nivel devolvía `unknown`, que es
 * justo lo que impedía escribir `callArg(...).where[Op.or]` en los specs de repositorio.
 */
export interface CallArgRecord {
  [key: string]: CallArgRecord;
  [key: symbol]: CallArgRecord;
}

export function callArg<T = unknown>(mockFn: unknown, callIndex = 0, argIndex = 0): T {
  const calls = (mockFn as { mock?: { calls?: unknown[][] } }).mock?.calls;
  if (!calls || calls.length <= callIndex) {
    throw new Error(`El mock no registró la llamada #${callIndex} (llamadas: ${calls?.length ?? 0}).`);
  }
  return calls[callIndex]![argIndex] as T;
}
