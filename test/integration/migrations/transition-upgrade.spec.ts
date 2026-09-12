/**
 * @file AT-053 — la instalación existente se actualiza sin perder pendientes ni referencias, y el relleno
 *   por lotes se reanuda desde su punto de control.
 * @business Quien ya tiene Atlas en marcha no puede perder un evento pendiente ni una clave de
 *   idempotencia al pasar por las migraciones de la transición; y si un relleno se interrumpe, al
 *   reanudarlo no repite ni salta filas.
 * @system PostgreSQL de pruebas con el MISMO corredor (`umzug` sobre `src/database/migrations`, tabla
 *   `SequelizeMeta`) y la identidad de migración: (1) `up` en una base al día es un no-op; (2) baja las
 *   dos migraciones de la transición con filas sembradas «como las dejó la versión anterior», las vuelve
 *   a subir y comprueba que las filas siguen y reciben los valores por defecto; (3) un relleno por lotes
 *   interrumpido tras el primer lote se reanuda sin duplicar (cada fila se toca exactamente una vez).
 *   La restauración desde copia (pg_dump) no se prueba aquí: está en el runbook.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { join } from 'node:path';
import { QueryTypes, type QueryInterface } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { SequelizeStorage, Umzug } from 'umzug';
import { createMigrationSequelizeInstance } from '../../../src/database/sequelize.js';
import { runBatchBackfill, type BackfillCheckpoint } from '../../../src/platform/persistence/batch-backfill.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

const TRANSITION_MIGRATIONS = ['20260911180000-idempotency-keys-owner-token.ts', '20260911190000-outbox-envelope-and-inbox-receipts.ts'];

let database: IntegrationDatabase | null = null;
let migrator: Sequelize | null = null;
let umzug: Umzug<QueryInterface> | null = null;
const marker = `it-upgrade-${runToken()}`;

function buildUmzug(sequelize: Sequelize): Umzug<QueryInterface> {
  return new Umzug({
    migrations: {
      glob: join(__dirname, '..', '..', '..', 'src', 'database', 'migrations', '*.ts').replace(/\\/g, '/'),
      resolve: ({ name, path, context }) => ({
        name,
        up: async () => ((await import(path as string)) as { up: (p: { context: unknown }) => Promise<void> }).up({ context }),
        down: async () => ((await import(path as string)) as { down: (p: { context: unknown }) => Promise<void> }).down({ context }),
      }),
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: undefined,
  });
}

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  migrator = createMigrationSequelizeInstance();
  umzug = buildUmzug(migrator);
});

afterAll(async () => {
  // Pase lo que pase, la base queda al día para las suites siguientes.
  if (umzug) await umzug.up();
  if (database) {
    await database.sequelize.query('DELETE FROM platform_ops.outbox_events WHERE event_code = $marker', { bind: { marker } });
    await database.sequelize.query('DELETE FROM platform_ops.idempotency_keys WHERE scope = $marker', { bind: { marker } });
  }
  await migrator?.close();
  await database?.close();
});

async function seedPreviousVersionRows(sequelize: Sequelize, count: number): Promise<void> {
  const now = new Date();
  for (let index = 0; index < count; index += 1) {
    await sequelize.query(
      `INSERT INTO platform_ops.outbox_events (_tenant_id, aggregate_type, aggregate_id, event_code, event_payload_json, status, attempts, available_at, _created_at)
       VALUES (NULL, 'legacy', $id, $marker, '{}'::jsonb, 'pending', 0, $now, $now)`,
      { bind: { id: String(index), marker, now } },
    );
  }
  await sequelize.query(
    `INSERT INTO platform_ops.idempotency_keys (tenant_scope, idempotency_key, scope, request_hash, status, _created_at)
     VALUES ('tenant:1', $key, $marker, 'hash', 'completed', $now)`,
    { bind: { key: `${marker}-key`, marker, now } },
  );
}

async function columns(sequelize: Sequelize, table: string): Promise<string[]> {
  const rows = await sequelize.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'platform_ops' AND table_name = $table`,
    { type: QueryTypes.SELECT, bind: { table } },
  );
  return rows.map((row) => row.column_name);
}

describe('AT-053 · actualización de una instalación existente', () => {
  it('base al día: no hay migraciones pendientes y `up` es un no-op', async () => {
    if (!umzug) return;
    expect(await umzug.pending()).toEqual([]);
    const executedBefore = (await umzug.executed()).length;
    await umzug.up();
    expect((await umzug.executed()).length).toBe(executedBefore);
  });

  it('desde la versión anterior: bajar y volver a subir la transición conserva pendientes y claves, y rellena los defectos', async () => {
    if (!umzug || !database) return;
    const sequelize = database.sequelize;
    await seedPreviousVersionRows(sequelize, 3);

    // Versión anterior: sin sobre, sin inbox, sin owner_token en idempotencia.
    await umzug.down({ step: TRANSITION_MIGRATIONS.length });
    expect((await umzug.pending()).map((m) => m.name)).toEqual(TRANSITION_MIGRATIONS);
    expect(await columns(sequelize, 'outbox_events')).not.toEqual(expect.arrayContaining(['event_id', 'owner_token']));
    expect(await columns(sequelize, 'idempotency_keys')).not.toContain('owner_token');
    const pendingBefore = await sequelize.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM platform_ops.outbox_events WHERE event_code = $marker AND status = 'pending'`,
      { type: QueryTypes.SELECT, bind: { marker } },
    );
    expect(Number(pendingBefore[0].n)).toBe(3);

    // Actualización: las filas siguen, con identidad global y versión de esquema por defecto.
    await umzug.up();
    expect(await umzug.pending()).toEqual([]);
    const rows = await sequelize.query<{ event_id: string; schema_version: number; owner_token: string | null; status: string }>(
      `SELECT event_id, schema_version, owner_token, status FROM platform_ops.outbox_events WHERE event_code = $marker ORDER BY _id`,
      { type: QueryTypes.SELECT, bind: { marker } },
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(3);
    for (const row of rows) {
      expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.schema_version).toBe(1);
      expect(row.owner_token).toBeNull();
      expect(row.status).toBe('pending');
    }
    const keys = await sequelize.query<{ owner_token: string | null; status: string }>(
      `SELECT owner_token, status FROM platform_ops.idempotency_keys WHERE scope = $marker`,
      { type: QueryTypes.SELECT, bind: { marker } },
    );
    expect(keys).toEqual([{ owner_token: null, status: 'completed' }]);
    // Reinicio idempotente: subir otra vez no cambia nada.
    await umzug.up();
    expect(await umzug.pending()).toEqual([]);
  });

  it('relleno por lotes interrumpido tras el primer lote: se reanuda desde el punto de control sin duplicar ni omitir', async () => {
    if (!database) return;
    const sequelize = database.sequelize;
    const now = new Date();
    for (let index = 0; index < 5; index += 1) {
      await sequelize.query(
        `INSERT INTO platform_ops.outbox_events (_tenant_id, aggregate_type, aggregate_id, event_code, event_payload_json, status, attempts, available_at, _created_at, producer)
         VALUES (NULL, 'legacy', $id, $marker, '{}'::jsonb, 'processed', 0, $now, $now, NULL)`,
        { bind: { id: `bf-${index}`, marker, now } },
      );
    }
    // Punto de control «persistido» por el plan (en producción: fila de control escrita en la misma transacción).
    let stored: BackfillCheckpoint | null = null;
    const plan = {
      fetch: async (afterId: string | null, limit: number) =>
        sequelize.query<{ id: string }>(
          `SELECT _id::text AS id FROM platform_ops.outbox_events
           WHERE event_code = $marker AND aggregate_id LIKE 'bf-%' AND ($afterId::bigint IS NULL OR _id > $afterId::bigint)
           ORDER BY _id ASC LIMIT $limit`,
          { type: QueryTypes.SELECT, bind: { marker, afterId, limit } },
        ),
      idOf: (row: { id: string }) => row.id,
      apply: async (rows: readonly { id: string }[], checkpoint: BackfillCheckpoint) => {
        await sequelize.transaction(async (transaction) => {
          // `attempts + 1` cuenta cuántas veces se tocó cada fila: la prueba exige exactamente una.
          await sequelize.query(
            `UPDATE platform_ops.outbox_events SET producer = 'legacy-backfill', attempts = attempts + 1 WHERE _id = ANY($ids::bigint[])`,
            { bind: { ids: rows.map((row) => row.id) }, transaction },
          );
          stored = checkpoint;
        });
      },
      load: async () => stored,
    };

    const interrupted = await runBatchBackfill(plan, { batchSize: 2, maxBatches: 1 });
    expect(interrupted.done).toBe(false);
    expect(interrupted.checkpoint.processed).toBe(2);

    const resumed = await runBatchBackfill(plan, { batchSize: 2 });
    expect(resumed.done).toBe(true);
    expect(resumed.checkpoint.processed).toBe(5);
    expect(resumed.checkpoint.batches).toBe(3);

    const touched = await sequelize.query<{ producer: string | null; attempts: number }>(
      `SELECT producer, attempts FROM platform_ops.outbox_events WHERE event_code = $marker AND aggregate_id LIKE 'bf-%' ORDER BY _id`,
      { type: QueryTypes.SELECT, bind: { marker } },
    );
    expect(touched).toHaveLength(5);
    expect(touched.every((row) => row.producer === 'legacy-backfill' && row.attempts === 1)).toBe(true);
  });
});
