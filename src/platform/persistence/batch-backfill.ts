/**
 * @file Relleno por lotes con punto de control (AT-053): reanudable, sin duplicar ni omitir filas.
 * @business Un relleno de datos de una migración de transición puede interrumpirse (despliegue, caída);
 *   al reanudarlo tiene que seguir desde la última fila confirmada, no desde el principio ni desde una
 *   estimación. Y cada lote se aplica con su punto de control en la MISMA transacción.
 * @system Función pura sobre un plan: `fetch(afterId, limit)` devuelve el siguiente lote ordenado por
 *   id ascendente; `apply(rows, checkpoint)` escribe el lote y persiste el punto de control juntos (el
 *   plan decide dónde: la tabla del dominio y una fila de control). `load()` recupera el punto al
 *   arrancar. Sin Sequelize aquí: el adaptador es del plan.
 */
export type BackfillCheckpoint = Readonly<{ lastId: string | null; processed: number; batches: number }>;

export type BatchBackfillPlan<TRow> = Readonly<{
  /** Siguiente lote estrictamente posterior a `afterId`, ordenado por id ascendente; vacío = terminado. */
  fetch: (afterId: string | null, limit: number) => Promise<readonly TRow[]>;
  idOf: (row: TRow) => string;
  /** Aplica el lote Y guarda el punto de control atómicamente. Si lanza, nada del lote cuenta. */
  apply: (rows: readonly TRow[], checkpoint: BackfillCheckpoint) => Promise<void>;
  /** Punto de control persistido de una corrida anterior; `null` si es la primera. */
  load: () => Promise<BackfillCheckpoint | null>;
}>;

export type BatchBackfillOptions = Readonly<{
  batchSize: number;
  /** Tope de lotes por corrida (para ventanas cortas o para simular una interrupción en pruebas). */
  maxBatches?: number;
}>;

export type BatchBackfillResult = Readonly<{ checkpoint: BackfillCheckpoint; done: boolean }>;

export const INITIAL_CHECKPOINT: BackfillCheckpoint = Object.freeze({ lastId: null, processed: 0, batches: 0 });

export async function runBatchBackfill<TRow>(plan: BatchBackfillPlan<TRow>, options: BatchBackfillOptions): Promise<BatchBackfillResult> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) throw new Error('BACKFILL_BATCH_SIZE_INVALID');
  let checkpoint = (await plan.load()) ?? INITIAL_CHECKPOINT;
  let batchesThisRun = 0;
  for (;;) {
    if (options.maxBatches !== undefined && batchesThisRun >= options.maxBatches) return { checkpoint, done: false };
    const rows = await plan.fetch(checkpoint.lastId, options.batchSize);
    if (rows.length === 0) return { checkpoint, done: true };
    const ids = rows.map(plan.idOf);
    // El orden es la garantía de reanudación: si el lote no viene ascendente, el punto de control mentiría.
    for (let index = 1; index < ids.length; index += 1) {
      if (compareIds(ids[index - 1], ids[index]) >= 0) throw new Error(`BACKFILL_BATCH_NOT_ASCENDING: ${ids[index - 1]} ≥ ${ids[index]}`);
    }
    if (checkpoint.lastId !== null && compareIds(ids[0], checkpoint.lastId) <= 0) {
      throw new Error(`BACKFILL_BATCH_BEHIND_CHECKPOINT: ${ids[0]} ≤ ${checkpoint.lastId}`);
    }
    const next: BackfillCheckpoint = Object.freeze({
      lastId: ids[ids.length - 1],
      processed: checkpoint.processed + rows.length,
      batches: checkpoint.batches + 1,
    });
    await plan.apply(rows, next);
    checkpoint = next;
    batchesThisRun += 1;
  }
}

/** Ids numéricos (BIGSERIAL como texto) se comparan por valor; el resto, como texto. */
function compareIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
