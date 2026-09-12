/**
 * @file Copia por lotes de las tablas de Mensajería hacia el destino del piloto y reconciliación (AT-058).
 * @business Antes de que el piloto tenga base propia hay que poder copiar lo que Mensajería posee, reanudar
 *   si la copia se corta, captar lo que llegó durante la copia hasta una marca de agua acordada, y
 *   demostrar con conteos, ids y hashes que origen y destino coinciden. Nada de esto envía un mensaje.
 * @system Sobre `runBatchBackfill`: lotes ascendentes por `_id`, `INSERT … ON CONFLICT (_id) DO NOTHING`
 *   y punto de control en la misma transacción (`<destino>.backfill_checkpoints`). La marca de agua es
 *   `_created_at <= watermark`; las ACTUALIZACIONES posteriores de una fila ya copiada no se captan (no
 *   hay CDC): la sincronización final se hace con el origen drenado (runbook `messaging-shadow-read.md`).
 *   El destino se prepara con `LIKE … INCLUDING ALL` (misma forma, mismos índices).
 */
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { runBatchBackfill, type BackfillCheckpoint, type BatchBackfillResult } from '../../../../platform/persistence/batch-backfill.js';

export const MESSAGING_TABLES = [
  'notification_templates',
  'notification_policies',
  'notification_messages',
  'notification_deliveries',
  'user_notification_preferences',
  'device_tokens',
] as const;
export type MessagingTable = (typeof MESSAGING_TABLES)[number];

const SOURCE_SCHEMA = 'messaging';
const CHECKPOINTS = 'backfill_checkpoints';
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(value: string): string {
  if (!IDENT.test(value)) throw new Error(`BACKFILL_IDENTIFIER_INVALID: ${value}`);
  return value;
}

/** Marca de agua tomada del reloj de la BASE: el de la máquina que copia puede ir adelantado o atrasado. */
export async function databaseNow(sequelize: Sequelize): Promise<Date> {
  const rows = await sequelize.query<{ now: Date }>('SELECT now() AS now', { type: QueryTypes.SELECT });
  return new Date(rows[0].now);
}

export function assertMessagingTable(table: string): MessagingTable {
  if (!(MESSAGING_TABLES as readonly string[]).includes(table)) throw new Error(`BACKFILL_TABLE_NOT_MESSAGING: ${table}`);
  return table as MessagingTable;
}

/** Crea el schema destino, una copia de forma de cada tabla y la tabla de puntos de control. DDL: identidad de migración. */
export async function prepareTarget(sequelize: Sequelize, targetSchema: string): Promise<void> {
  const target = ident(targetSchema);
  await sequelize.query(`CREATE SCHEMA IF NOT EXISTS ${target}`);
  for (const table of MESSAGING_TABLES) {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS ${target}.${table} (LIKE ${SOURCE_SCHEMA}.${table} INCLUDING ALL)`);
  }
  await sequelize.query(`CREATE TABLE IF NOT EXISTS ${target}.${CHECKPOINTS} (
    table_name TEXT PRIMARY KEY,
    last_id BIGINT,
    processed BIGINT NOT NULL DEFAULT 0,
    batches INTEGER NOT NULL DEFAULT 0,
    watermark TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

export type CopyInput = Readonly<{
  sequelize: Sequelize;
  table: MessagingTable;
  targetSchema: string;
  /** Sólo filas creadas hasta aquí; lo posterior se capta en la siguiente pasada (catch-up). */
  watermark: Date;
  batchSize: number;
  maxBatches?: number;
}>;

type SourceRow = { id: string; row: Record<string, unknown> };

export async function copyTable(input: CopyInput): Promise<BatchBackfillResult> {
  const { sequelize } = input;
  const table = assertMessagingTable(input.table);
  const target = ident(input.targetSchema);
  const plan = {
    fetch: (afterId: string | null, limit: number) =>
      sequelize.query<SourceRow>(
        `SELECT t._id::text AS id, row_to_json(t) AS row FROM ${SOURCE_SCHEMA}.${table} t
         WHERE ($afterId::bigint IS NULL OR t._id > $afterId::bigint) AND t._created_at <= $watermark
         ORDER BY t._id ASC LIMIT $limit`,
        { type: QueryTypes.SELECT, bind: { afterId, watermark: input.watermark, limit } },
      ),
    idOf: (row: SourceRow) => row.id,
    apply: async (rows: readonly SourceRow[], checkpoint: BackfillCheckpoint) => {
      await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          `INSERT INTO ${target}.${table} SELECT * FROM json_populate_recordset(NULL::${target}.${table}, $rows::json) ON CONFLICT (_id) DO NOTHING`,
          { bind: { rows: JSON.stringify(rows.map((row) => row.row)) }, transaction },
        );
        await sequelize.query(
          `INSERT INTO ${target}.${CHECKPOINTS} (table_name, last_id, processed, batches, watermark, updated_at)
           VALUES ($table, $lastId::bigint, $processed, $batches, $watermark, now())
           ON CONFLICT (table_name) DO UPDATE SET last_id = EXCLUDED.last_id, processed = EXCLUDED.processed, batches = EXCLUDED.batches, watermark = EXCLUDED.watermark, updated_at = now()`,
          {
            bind: {
              table,
              lastId: checkpoint.lastId,
              processed: checkpoint.processed,
              batches: checkpoint.batches,
              watermark: input.watermark,
            },
            transaction,
          },
        );
      });
    },
    load: async (): Promise<BackfillCheckpoint | null> => {
      const rows = await sequelize.query<{ last_id: string | null; processed: string; batches: number }>(
        `SELECT last_id::text AS last_id, processed::text AS processed, batches FROM ${target}.${CHECKPOINTS} WHERE table_name = $table`,
        { type: QueryTypes.SELECT, bind: { table } },
      );
      const row = rows[0];
      return row ? { lastId: row.last_id, processed: Number(row.processed), batches: row.batches } : null;
    },
  };
  return runBatchBackfill(plan, { batchSize: input.batchSize, maxBatches: input.maxBatches });
}

export type Reconciliation = Readonly<{
  table: MessagingTable;
  sourceCount: number;
  targetCount: number;
  missingInTarget: readonly string[];
  extraInTarget: readonly string[];
  /** md5 encadenado de las filas (sin datos en claro en el informe). */
  hashMatch: boolean;
}>;

export async function reconcileTable(input: {
  sequelize: Sequelize;
  table: MessagingTable;
  targetSchema: string;
  watermark: Date;
}): Promise<Reconciliation> {
  const { sequelize } = input;
  const table = assertMessagingTable(input.table);
  const target = ident(input.targetSchema);
  const bind = { watermark: input.watermark };
  const [source] = await sequelize.query<{ n: string; h: string | null }>(
    `SELECT count(*)::text AS n, md5(coalesce(string_agg(md5(t::text), ',' ORDER BY t._id), '')) AS h FROM ${SOURCE_SCHEMA}.${table} t WHERE t._created_at <= $watermark`,
    { type: QueryTypes.SELECT, bind },
  );
  const [copied] = await sequelize.query<{ n: string; h: string | null }>(
    `SELECT count(*)::text AS n, md5(coalesce(string_agg(md5(t::text), ',' ORDER BY t._id), '')) AS h FROM ${target}.${table} t`,
    { type: QueryTypes.SELECT },
  );
  const missing = await sequelize.query<{ id: string }>(
    `SELECT _id::text AS id FROM ${SOURCE_SCHEMA}.${table} WHERE _created_at <= $watermark EXCEPT SELECT _id::text FROM ${target}.${table} ORDER BY 1`,
    { type: QueryTypes.SELECT, bind },
  );
  const extra = await sequelize.query<{ id: string }>(
    `SELECT _id::text AS id FROM ${target}.${table} EXCEPT SELECT _id::text FROM ${SOURCE_SCHEMA}.${table} WHERE _created_at <= $watermark ORDER BY 1`,
    { type: QueryTypes.SELECT, bind },
  );
  return Object.freeze({
    table,
    sourceCount: Number(source.n),
    targetCount: Number(copied.n),
    missingInTarget: missing.map((row) => row.id),
    extraInTarget: extra.map((row) => row.id),
    hashMatch: source.h === copied.h,
  });
}

/** Lectura sombra: lo que el piloto VERÍA. Sólo SELECT sobre el destino; sin adaptadores, sin proveedores, sin escritura. */
export async function shadowReadSummary(input: {
  sequelize: Sequelize;
  targetSchema: string;
}): Promise<{ messagesByStatus: Record<string, number>; deliveriesByStatus: Record<string, number> }> {
  const target = ident(input.targetSchema);
  const group = async (table: 'notification_messages' | 'notification_deliveries') => {
    const rows = await input.sequelize.query<{ status: string; n: string }>(
      `SELECT status, count(*)::text AS n FROM ${target}.${table} GROUP BY status ORDER BY status`,
      { type: QueryTypes.SELECT },
    );
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
  };
  return { messagesByStatus: await group('notification_messages'), deliveriesByStatus: await group('notification_deliveries') };
}
