/**
 * @file AT-053 — el relleno por lotes no duplica ni omite filas, y se niega a mentir sobre su progreso.
 * @business Un relleno de datos que se corta tiene que reanudarse desde lo último confirmado. Si el plan
 *   devuelve un lote desordenado o anterior al punto de control, el punto de control mentiría: se aborta.
 * @system Función pura con un plan en memoria; sin base ni Nest.
 */
import { describe, expect, it } from '@jest/globals';
import { INITIAL_CHECKPOINT, runBatchBackfill, type BackfillCheckpoint } from '../../../src/platform/persistence/batch-backfill.js';

type Row = { id: string };

function planOf(ids: string[], options: { onApply?: (rows: readonly Row[]) => void } = {}) {
  let stored: BackfillCheckpoint | null = null;
  const applied: string[] = [];
  return {
    applied,
    checkpoint: () => stored,
    plan: {
      fetch: async (afterId: string | null, limit: number) =>
        ids
          .filter((id) => afterId === null || BigInt(id) > BigInt(afterId))
          .slice(0, limit)
          .map((id) => ({ id })),
      idOf: (row: Row) => row.id,
      apply: async (rows: readonly Row[], checkpoint: BackfillCheckpoint) => {
        applied.push(...rows.map((row) => row.id));
        options.onApply?.(rows);
        stored = checkpoint;
      },
      load: async () => stored,
    },
  };
}

describe('relleno por lotes con punto de control', () => {
  it('recorre todas las filas una sola vez y termina', async () => {
    const { plan, applied } = planOf(['1', '2', '3', '4', '5']);
    const result = await runBatchBackfill(plan, { batchSize: 2 });
    expect(result.done).toBe(true);
    expect(result.checkpoint).toEqual({ lastId: '5', processed: 5, batches: 3 });
    expect(applied).toEqual(['1', '2', '3', '4', '5']);
  });

  it('interrumpido por `maxBatches`: se reanuda desde el punto de control sin repetir', async () => {
    const first = planOf(['1', '2', '3', '4']);
    const interrupted = await runBatchBackfill(first.plan, { batchSize: 2, maxBatches: 1 });
    expect(interrupted).toEqual({ done: false, checkpoint: { lastId: '2', processed: 2, batches: 1 } });
    const resumed = await runBatchBackfill(first.plan, { batchSize: 2 });
    expect(resumed.done).toBe(true);
    expect(first.applied).toEqual(['1', '2', '3', '4']);
  });

  it('una colección vacía termina sin tocar nada y conserva el punto de control inicial', async () => {
    const { plan, applied } = planOf([]);
    expect(await runBatchBackfill(plan, { batchSize: 10 })).toEqual({ done: true, checkpoint: INITIAL_CHECKPOINT });
    expect(applied).toEqual([]);
  });

  it('un lote desordenado o anterior al punto de control aborta: el punto de control no puede mentir', async () => {
    const descending = {
      fetch: async () => [{ id: '9' }, { id: '4' }],
      idOf: (row: Row) => row.id,
      apply: async () => undefined,
      load: async () => null,
    };
    await expect(runBatchBackfill(descending, { batchSize: 2 })).rejects.toThrow(/BACKFILL_BATCH_NOT_ASCENDING/);
    const behind = {
      fetch: async () => [{ id: '1' }],
      idOf: (row: Row) => row.id,
      apply: async () => undefined,
      load: async () => ({ lastId: '5', processed: 5, batches: 1 }),
    };
    await expect(runBatchBackfill(behind, { batchSize: 1 })).rejects.toThrow(/BACKFILL_BATCH_BEHIND_CHECKPOINT/);
  });

  it('un tamaño de lote inválido se rechaza antes de leer nada', async () => {
    const { plan, applied } = planOf(['1']);
    await expect(runBatchBackfill(plan, { batchSize: 0 })).rejects.toThrow(/BACKFILL_BATCH_SIZE_INVALID/);
    expect(applied).toEqual([]);
  });

  it('si `apply` falla, el punto de control no avanza: el reintento repite ese lote y sólo ese', async () => {
    let fail = true;
    const { plan, applied, checkpoint } = planOf(['1', '2'], {
      onApply: () => {
        if (fail) {
          fail = false;
          throw new Error('fallo al escribir el lote');
        }
      },
    });
    await expect(runBatchBackfill(plan, { batchSize: 1 })).rejects.toThrow('fallo al escribir el lote');
    expect(checkpoint()).toBeNull();
    const resumed = await runBatchBackfill(plan, { batchSize: 1 });
    expect(resumed.done).toBe(true);
    expect(applied).toEqual(['1', '1', '2']);
  });
});
