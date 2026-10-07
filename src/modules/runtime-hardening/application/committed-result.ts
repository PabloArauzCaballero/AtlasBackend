/**
 * @file Marca de «el handler ya hizo su trabajo» que viaja con un error posterior al commit.
 * @business Esta pieza evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.
 * @system centraliza idempotencia y outbox como garantías transversales del runtime HTTP.
 */

/**
 * Un error que sale DESPUÉS de que el handler resolviera (p. ej. el INSERT del outbox de auditoría)
 * no significa que la mutación fallara: ya hizo commit. Si la idempotencia lo trataba como un fallo
 * del handler, marcaba la clave `failed` y el reintento con la misma clave volvía a ejecutar la
 * mutación. Quien detecta ese caso marca el error con el cuerpo que el handler devolvió, y la
 * idempotencia guarda ese cuerpo como resultado en vez de liberar la clave.
 *
 * Se marca el propio error (no se envuelve) para que el filtro de excepciones lo siga viendo igual.
 */
const committedResults = new WeakMap<object, { body: unknown }>();

export function markCommittedResult(error: unknown, body: unknown): unknown {
  const marked = error !== null && typeof error === 'object' ? error : new Error(String(error));
  committedResults.set(marked, { body });
  return marked;
}

export function committedResultOf(error: unknown): { body: unknown } | undefined {
  return error !== null && typeof error === 'object' ? committedResults.get(error) : undefined;
}
