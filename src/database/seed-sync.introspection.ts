/**
 * @file Lo que hay que PREGUNTARLE a PostgreSQL para copiar un conjunto sembrado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system introspecciona columnas, claves foráneas y secuencias del destino.
 */
import { Client } from 'pg';
import { quoteIdentifier, tableKey } from './seed-sync.types.js';
import type { ColumnRef, ForeignKeyRef, TableRef } from './seed-sync.types.js';

/**
 * Sale de `seed-sync.ts` porque aquel archivo mezclaba dos cosas de tamaño muy distinto: la
 * ORQUESTACIÓN de la copia —que es corta y es donde se decide el orden y qué se borra— y la
 * introspección del esquema, que son tres consultas largas a `information_schema` y un reajuste de
 * secuencias. Juntas pasaban de las 300 líneas que admite `check:file-size`.
 */

export async function readColumns(client: Client, tables: readonly TableRef[]): Promise<Map<string, ColumnRef[]>> {
  const { rows } = await client.query<{
    schema: string;
    table: string;
    column: string;
    type: string;
    identity: string;
    generated: string;
  }>(
    `SELECT n.nspname AS schema, c.relname AS "table", a.attname AS column,
            format_type(a.atttypid, a.atttypmod) AS type,
            a.attidentity AS identity, a.attgenerated AS generated
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname || '.' || c.relname = ANY($1::text[])
      ORDER BY a.attnum`,
    [tables.map(tableKey)],
  );

  const byTable = new Map<string, ColumnRef[]>();
  for (const row of rows) {
    // Una columna GENERATED ALWAYS AS la recalcula el destino: insertarla es un error de sintaxis.
    if (row.generated === 's') continue;
    const key = `${row.schema}.${row.table}`;
    const columns = byTable.get(key) ?? [];
    columns.push({ name: row.column, type: row.type, alwaysIdentity: row.identity === 'a' });
    byTable.set(key, columns);
  }
  return byTable;
}

/**
 * Claves foráneas que TOCAN el manifiesto, en cualquiera de los dos sentidos.
 *
 * Las que salen de una tabla del manifiesto hay que retirarlas para poder cargar en cualquier orden.
 * Las que ENTRAN —una tabla de runtime que apunta a una sembrada— hay que retirarlas por una razón
 * distinta y menos evidente: sin ellas, vaciar exigiría `TRUNCATE ... CASCADE`, y CASCADE alcanza a
 * esas tablas de runtime y las vacía también. Es un fallo caro y silencioso: al traer 8 840 filas de
 * catálogo se llevó por delante 390 000 de bitácora de auditoría, que no son semilla de nadie.
 *
 * Retirándolas se puede truncar SIN cascade, y al recrearlas se valida que las filas de runtime
 * siguen apuntando a algo que existe. Si la rama trae un catálogo incompatible con lo que ya hay
 * escrito, el `ALTER` falla y la carga entera se revierte — que es exactamente lo que debe pasar.
 */
export async function readForeignKeys(client: Client, tables: readonly TableRef[]): Promise<ForeignKeyRef[]> {
  const { rows } = await client.query<ForeignKeyRef>(
    `SELECT n.nspname AS schema, c.relname AS "table", co.conname AS name,
            pg_get_constraintdef(co.oid) AS definition
       FROM pg_constraint co
       JOIN pg_class c ON c.oid = co.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class pc ON pc.oid = co.confrelid
       JOIN pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE co.contype = 'f'
        AND (n.nspname || '.' || c.relname = ANY($1::text[])
             OR pn.nspname || '.' || pc.relname = ANY($1::text[]))
      ORDER BY 1, 2, 3`,
    [tables.map(tableKey)],
  );
  return rows;
}

/** Deja cada secuencia por encima del máximo copiado: sin esto el primer INSERT del runtime choca. */
export async function resyncSequences(target: Client, tables: readonly TableRef[], log: (message: string) => void): Promise<void> {
  const { rows } = await target.query<{ schema: string; table: string; column: string; seq: string }>(
    // El CTE es MATERIALIZED a propósito. Sin él, el planificador puede evaluar
    // `pg_get_serial_sequence` ANTES de aplicar el filtro de nombres, y entonces la llama sobre
    // relaciones que no son del manifiesto —incluidas las de `pg_toast`—, que un rol no
    // superusuario no puede leer: la carga entera moría con «permission denied for schema
    // pg_toast». Con un superusuario no se nota, que es exactamente por lo que conviene fijarlo.
    `WITH columnas AS MATERIALIZED (
       SELECT n.nspname AS schema, c.relname AS "table", a.attname AS col
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
          AND n.nspname || '.' || c.relname = ANY($1::text[])
     )
     SELECT schema, "table", col AS "column", seq
       FROM (
         SELECT schema, "table", col,
                pg_get_serial_sequence(format('%I.%I', schema, "table"), col) AS seq
           FROM columnas
       ) resueltas
      WHERE seq IS NOT NULL`,
    [tables.map(tableKey)],
  );

  for (const row of rows) {
    await target.query(
      `SELECT setval($1, COALESCE((SELECT MAX(${quoteIdentifier(row.column)}) FROM ${quoteIdentifier(row.schema)}.${quoteIdentifier(row.table)}), 0) + 1, false)`,
      [row.seq],
    );
  }
  if (rows.length > 0) log(`Secuencias reposicionadas: ${rows.length}.`);
}
