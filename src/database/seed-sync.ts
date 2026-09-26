/**
 * @file Copia el conjunto sembrado desde la rama de semillas hasta esta base.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Client } from 'pg';
import { readColumns, readForeignKeys, resyncSequences } from './seed-sync.introspection.js';
import { quoteIdentifier, quoteTable, tableKey } from './seed-sync.types.js';
import type { ColumnRef, ForeignKeyRef, TableRef } from './seed-sync.types.js';

export type { ColumnRef, ForeignKeyRef, TableRef };

/**
 * Trae los datos de semilla de la rama publicada a la base local.
 *
 * Reemplaza a los antiguos seeders versionados. El motivo del cambio no es sólo el peso: un
 * seeder es código que se ejecuta, y cuando el esquema evoluciona por debajo deja de ser
 * reproducible en silencio —el catálogo de sistemas llevaba meses fallando contra una base
 * limpia porque una migración añadió `system_code` a un índice único y su `ON CONFLICT` se quedó
 * atrás—. Copiar un conjunto ya materializado no puede derivar de esa forma: o las filas encajan
 * en el esquema del destino, o la carga falla entera y se ve.
 *
 * ### Por qué se retiran las claves foráneas en vez de ordenar las tablas
 *
 * El grafo de Atlas tiene CICLOS reales (`customers` ↔ `customer_profile_versions`,
 * `risk_assessment_runs` ↔ `risk_assessment_results`): no existe ningún orden topológico válido.
 * La alternativa habitual, `session_replication_role = replica`, exige un privilegio que el
 * PostgreSQL gestionado no concede al rol propietario. Así que la carga entera ocurre dentro de
 * UNA transacción que retira las restricciones, copia y las vuelve a crear. Recrearlas es lo que
 * VALIDA el resultado: una fila huérfana aborta el `ALTER` y revierte la carga completa, de modo
 * que la base nunca queda a medias ni —lo importante— sin restricciones.
 *
 * ### Por qué los valores viajan como texto
 *
 * `col::text` al leer y `$n::tipo` al escribir. La representación textual de PostgreSQL es la
 * inversa de su entrada para todos los tipos que usa Atlas —arrays, jsonb, bytea, enums, rangos,
 * `citext`—, así que el copiado no depende de cómo el driver traduzca cada tipo a JavaScript ni
 * de que ambas puntas usen la misma versión de `pg`.
 */

/** Contabilidad de migraciones y seeds: describe al DESTINO, así que nunca se copia. */
const TRACKING_TABLES = new Set([
  'public.SequelizeMeta',
  'public.SequelizeDataSeedersDevelopment',
  'public.SequelizeDataSeedersDevelopments',
  'public.SequelizeDataSeedersProduction',
  'public.SequelizeDataSeedersProductions',
  'public.atlas_sql_migrations',
  'public._prisma_migrations',
]);

const EXCLUDED_SCHEMAS = ['pg_catalog', 'information_schema', 'atlas_seed'];

/** Tope de parámetros por sentencia. PostgreSQL admite 65535; se deja margen. */
const MAX_PARAMS = 30000;

export interface SeedSyncResult {
  readonly rows: number;
  readonly tables: number;
}

/** Tablas con al menos una fila en el origen. Es el manifiesto: lo que el origen considera semilla. */
export async function listSeededTables(client: Client): Promise<TableRef[]> {
  const { rows } = await client.query<{ schema: string; name: string; rows: string }>(
    `SELECT n.nspname AS schema, c.relname AS name,
            (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint AS rows
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname <> ALL($1::text[])
      ORDER BY 1, 2`,
    [EXCLUDED_SCHEMAS],
  );
  return rows
    .filter((row) => Number(row.rows) > 0 && !TRACKING_TABLES.has(`${row.schema}.${row.name}`))
    .map((row) => ({ schema: row.schema, name: row.name, rows: Number(row.rows) }));
}

async function copyTable(
  source: Client,
  target: Client,
  table: TableRef,
  columns: readonly ColumnRef[],
  log: (message: string) => void,
): Promise<number> {
  if (columns.length === 0) return 0;

  const selectList = columns.map((column) => `${quoteIdentifier(column.name)}::text AS ${quoteIdentifier(column.name)}`).join(', ');
  const { rows } = await source.query<Record<string, string | null>>(`SELECT ${selectList} FROM ${quoteTable(table)}`);
  if (rows.length === 0) return 0;

  // Una identidad GENERATED ALWAYS rechaza el valor explícito salvo con OVERRIDING SYSTEM VALUE, y
  // conservar el identificador de origen es justo lo que mantiene válidas las claves foráneas.
  const overriding = columns.some((column) => column.alwaysIdentity) ? ' OVERRIDING SYSTEM VALUE' : '';
  const columnList = columns.map((column) => quoteIdentifier(column.name)).join(', ');
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / columns.length));

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const parameters: (string | null)[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        parameters.push(row[column.name] ?? null);
        return `$${parameters.length}::${column.type}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await target.query(`INSERT INTO ${quoteTable(table)} (${columnList})${overriding} VALUES ${tuples.join(', ')}`, parameters);
    inserted += chunk.length;
  }

  log(`  ${tableKey(table).padEnd(52)} ${String(inserted).padStart(6)} filas`);
  return inserted;
}

/**
 * Copia el conjunto sembrado de `source` a `target`. Es DESTRUCTIVO sobre las tablas del
 * manifiesto: las vacía antes de cargarlas, para que el resultado sea el conjunto publicado y no
 * una mezcla con lo que hubiera antes.
 */
/**
 * ¿Se ha traído alguna vez el conjunto sembrado a esta base?
 *
 * Es la pregunta que gobierna `--if-empty`, y NO se puede responder contando filas. Una base recién
 * migrada ya tiene datos: las migraciones insertan permisos internos, plantillas de notificación y
 * la versión del esquema. Con «¿hay alguna tabla poblada?» el arranque automatizado se saltaba la
 * siembra en una base virgen y dejaba la instalación sin catálogo, que es justo lo contrario de lo
 * que la guarda pretende.
 *
 * Así que la carga deja una MARCA y la guarda mira la marca. Es exacto en los dos sentidos: una base
 * nueva no la tiene y se siembra; una base ya sembrada la tiene y no se toca, por muchas filas que
 * el runtime haya escrito o borrado desde entonces.
 */
export async function hasSeedLoad(target: Client): Promise<boolean> {
  const { rows } = await target.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'atlas_seed' AND c.relname = 'load_log' AND c.relkind = 'r'
     ) AS exists`,
  );
  if (!rows[0]?.exists) return false;
  const { rows: count } = await target.query<{ n: string }>('SELECT count(*)::text AS n FROM atlas_seed.load_log');
  return Number(count[0]?.n ?? '0') > 0;
}

/** Deja constancia en el DESTINO de qué se trajo y de dónde. La lee {@link hasSeedLoad}. */
async function recordSeedLoad(target: Client, meta: { source: string; rows: number; tables: number }): Promise<void> {
  await target.query('CREATE SCHEMA IF NOT EXISTS atlas_seed');
  await target.query(
    `CREATE TABLE IF NOT EXISTS atlas_seed.load_log (
       id serial PRIMARY KEY,
       loaded_at timestamptz NOT NULL DEFAULT now(),
       source text NOT NULL,
       total_rows bigint NOT NULL,
       total_tables int NOT NULL
     )`,
  );
  await target.query('INSERT INTO atlas_seed.load_log (source, total_rows, total_tables) VALUES ($1, $2, $3)', [
    meta.source,
    meta.rows,
    meta.tables,
  ]);
}

export async function syncSeedData(options: {
  source: Client;
  target: Client;
  /** Cómo se llama la rama de origen, para dejarlo escrito en la marca de carga. */
  sourceLabel?: string;
  log?: (message: string) => void;
}): Promise<SeedSyncResult> {
  const { source, target } = options;
  // Progreso por stdout directo: es un flujo de avance de una tarea de línea de comandos, no un
  // evento de la aplicación, y `console` está restringido a error/warn en este repositorio.
  const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));

  const tables = await listSeededTables(source);
  if (tables.length === 0) {
    throw new Error('La rama de semillas no tiene ninguna tabla con datos: no hay nada que copiar.');
  }

  const columnsByTable = await readColumns(source, tables);
  const foreignKeys = await readForeignKeys(target, tables);
  log(`Origen: ${tables.length} tablas con datos, ${tables.reduce((total, table) => total + table.rows, 0)} filas.`);

  await target.query('BEGIN');
  try {
    for (const foreignKey of foreignKeys) {
      await target.query(
        `ALTER TABLE ${quoteIdentifier(foreignKey.schema)}.${quoteIdentifier(foreignKey.table)} DROP CONSTRAINT ${quoteIdentifier(foreignKey.name)}`,
      );
    }
    log(`Claves foráneas retiradas dentro de la transacción: ${foreignKeys.length}.`);

    // Los disparadores de usuario se apagan por dos razones distintas: hay tablas protegidas como
    // append-only —la cadena de auditoría rechaza TRUNCATE— y un BEFORE INSERT que recalcule
    // marcas de tiempo o hashes reescribiría filas que ya vienen calculadas del origen.
    for (const table of tables) await target.query(`ALTER TABLE ${quoteTable(table)} DISABLE TRIGGER USER`);

    // Sin CASCADE, y eso es el punto: CASCADE vaciaría también las tablas de runtime que
    // apuntan al catálogo. Se puede prescindir de él porque las claves que entran ya se retiraron.
    await target.query(`TRUNCATE TABLE ${tables.map(quoteTable).join(', ')} RESTART IDENTITY`);

    let copied = 0;
    for (const table of tables) {
      copied += await copyTable(source, target, table, columnsByTable.get(tableKey(table)) ?? [], log);
    }

    await resyncSequences(target, tables, log);
    for (const table of tables) await target.query(`ALTER TABLE ${quoteTable(table)} ENABLE TRIGGER USER`);

    for (const foreignKey of foreignKeys) {
      await target.query(
        `ALTER TABLE ${quoteIdentifier(foreignKey.schema)}.${quoteIdentifier(foreignKey.table)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} ${foreignKey.definition}`,
      );
    }
    log(`Claves foráneas recreadas y validadas: ${foreignKeys.length}.`);

    await recordSeedLoad(target, {
      source: options.sourceLabel ?? '(sin identificar)',
      rows: copied,
      tables: tables.length,
    });

    await target.query('COMMIT');
    return { rows: copied, tables: tables.length };
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  }
}
