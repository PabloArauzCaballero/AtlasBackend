/**
 * Ejecuta `fn` sobre `items` en lotes de a lo sumo `concurrency` en paralelo, en vez de
 * secuencialmente (un round trip de red/DB a la vez, lento) o todos a la vez (satura el pool de
 * conexiones). El mismo patrón manual (`for` incrementando de a `concurrency` + `Promise.all` por
 * chunk) se repetía inline en varios servicios de systems-ops y notifications con distinto nombre
 * de constante; centralizado acá para no volver a duplicarlo.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let start = 0; start < items.length; start += concurrency) {
    const chunk = items.slice(start, start + concurrency);
    const chunkResults = await Promise.all(chunk.map((item, offset) => fn(item, start + offset)));
    chunkResults.forEach((result, offset) => {
      results[start + offset] = result;
    });
  }
  return results;
}
