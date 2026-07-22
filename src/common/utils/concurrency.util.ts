/**
 * Ejecuta `fn` sobre `items` con a lo sumo `concurrency` llamadas en vuelo, en vez de
 * secuencialmente (un round trip de red/DB a la vez, lento) o todos a la vez (satura el pool de
 * conexiones). El mismo patrón manual se repetía inline en varios servicios de systems-ops y
 * notifications con distinto nombre de constante; centralizado acá para no volver a duplicarlo.
 *
 * Implementación de worker-pool DESLIZANTE: en cuanto un ítem termina, su worker toma el siguiente
 * pendiente. Así la concurrencia se mantiene constante y un ítem lento no bloquea el arranque del
 * resto (el enfoque anterior por chunks + `Promise.all` sufría head-of-line blocking: el chunk no
 * avanzaba hasta que su elemento más lento terminaba). El orden de `results` se preserva por índice.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
