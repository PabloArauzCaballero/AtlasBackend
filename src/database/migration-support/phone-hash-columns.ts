/**
 * @file Las columnas que guardan la huella de un teléfono, y cómo llevarlas todas a la versión de clave vigente (APP-21).
 * @business Convierte los SHA-256 desnudos —reversibles en segundos— en HMAC con la clave del servidor, sin necesitar ningún número en claro.
 * @system recorre por lotes cada columna (escalar o array) y reescribe sólo lo que no está en la versión vigente; idempotente.
 */
import { upgradeStoredPhoneHash, currentPhoneHashVersion } from '../../common/utils/crypto/phone-hash.util.js';
import { atlasSchemaFor } from '../domain-schemas.js';

/** Ejecuta una sentencia con parámetros posicionales (`$1`…) y devuelve las filas. La migración y la siembra la adaptan a su cliente. */
export type RunQuery = (sql: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

/** Los tipos de entidad con los que la lista de vigilancia y sus coincidencias guardan un teléfono. */
const PHONE_ENTITY_TYPES = "('phone', 'msisdn', 'phone_number')";

/** `schema` sólo para pruebas con tablas propias: las de negocio lo resuelven por `atlasSchemaFor`. */
export type PhoneHashColumn = { table: string; column: string; array?: true; where?: string; schema?: string };

/**
 * Todas las columnas con huella de teléfono. Una columna nueva con teléfonos se añade AQUÍ y se escribe con
 * `phoneLookupHash`; si no, la siguiente rotación la dejaría atrás.
 */
export const PHONE_HASH_COLUMNS: readonly PhoneHashColumn[] = [
  { table: 'customers', column: 'primary_phone_hash' },
  { table: 'customer_contact_methods', column: 'contact_value_hash', where: "contact_type = 'phone'" },
  { table: 'customer_contact_methods', column: 'normalized_value_hash', where: "contact_type = 'phone'" },
  { table: 'customer_reference_contacts', column: 'phone_hash' },
  { table: 'customer_device_contacts', column: 'primary_phone_hash' },
  { table: 'customer_device_contacts', column: 'phone_hashes', array: true },
  { table: 'watchlist_entries', column: 'entity_hash', where: `entity_type IN ${PHONE_ENTITY_TYPES}` },
  { table: 'watchlist_matches', column: 'matched_value_hash', where: `matched_entity_type IN ${PHONE_ENTITY_TYPES}` },
  { table: 'sim_observations', column: 'phone_number_hash' },
];

const BATCH = 1000;

const qualified = (spec: PhoneHashColumn): string => `"${spec.schema ?? atlasSchemaFor(spec.table)}"."${spec.table}"`;

/** Filtro de «no está en la versión vigente». `$1` es la expresión regular del prefijo vigente. */
function pendingFilter(spec: PhoneHashColumn): string {
  const col = `"${spec.column}"`;
  const pending = spec.array ? `EXISTS (SELECT 1 FROM unnest(${col}) AS h WHERE h !~ $1)` : `${col} IS NOT NULL AND ${col} !~ $1`;
  return spec.where ? `${pending} AND ${spec.where}` : pending;
}

function upgradeArray(values: string[]): string[] {
  // Distintos y ordenados, como los escribe `toContactRow`: dos lecturas de la misma ficha tienen que dar el mismo array.
  return [...new Set(values.map((value) => upgradeStoredPhoneHash(value) ?? value))].sort();
}

/** Cuántas filas de cada columna faltan por llevar a la versión vigente. Sin claves configuradas, cuenta contra la versión 1. */
export async function countPendingPhoneHashes(
  run: RunQuery,
  version: number,
  columns: readonly PhoneHashColumn[] = PHONE_HASH_COLUMNS,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const spec of columns) {
    const rows = await run(`SELECT count(*)::int AS n FROM ${qualified(spec)} WHERE ${pendingFilter(spec)}`, [`^ph${String(version)}:`]);
    counts[`${spec.table}.${spec.column}`] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

/** Filas que YA llevan una huella protegida (cualquier versión). Es lo que impide deshacer la conversión sin corromper. */
export async function countProtectedPhoneHashes(run: RunQuery, columns: readonly PhoneHashColumn[] = PHONE_HASH_COLUMNS): Promise<number> {
  let total = 0;
  for (const spec of columns) {
    const col = `"${spec.column}"`;
    const hit = spec.array ? `EXISTS (SELECT 1 FROM unnest(${col}) AS h WHERE h ~ '^ph[0-9]+:')` : `${col} ~ '^ph[0-9]+:'`;
    const where = spec.where ? `${hit} AND ${spec.where}` : hit;
    const rows = await run(`SELECT count(*)::int AS n FROM ${qualified(spec)} WHERE ${where}`, []);
    total += Number(rows[0]?.n ?? 0);
  }
  return total;
}

/**
 * Lleva TODAS las columnas a la versión vigente, por lotes de `_id`. Idempotente: lo que ya está en la vigente no se
 * toca, así que un corte a mitad se retoma volviendo a correrla. Si no hay nada pendiente no necesita la clave —una
 * base vacía (CI, entorno nuevo) migra sin ella—; si lo hay y la clave falta, falla antes de escribir nada.
 */
export async function upgradeAllPhoneHashes(
  run: RunQuery,
  log: (line: string) => void = () => undefined,
  columns: readonly PhoneHashColumn[] = PHONE_HASH_COLUMNS,
): Promise<Record<string, number>> {
  const pending = await countPendingPhoneHashes(run, 1, columns);
  const anything = Object.values(pending).some((n) => n > 0);
  const version = anything || (await countProtectedPhoneHashes(run, columns)) > 0 ? currentPhoneHashVersion() : 1;
  const prefix = `^ph${String(version)}:`;
  const converted: Record<string, number> = {};

  for (const spec of columns) {
    const key = `${spec.table}.${spec.column}`;
    converted[key] = 0;
    let lastId = '0';
    for (;;) {
      const rows = await run(
        `SELECT "_id"::text AS id, "${spec.column}" AS value FROM ${qualified(spec)}
          WHERE "_id" > $2::bigint AND ${pendingFilter(spec)} ORDER BY "_id" LIMIT ${String(BATCH)}`,
        [prefix, lastId],
      );
      if (rows.length === 0) break;
      const ids = rows.map((row) => String(row.id));
      if (spec.array) {
        const values = rows.map((row) => JSON.stringify(upgradeArray(row.value as string[])));
        await run(
          `UPDATE ${qualified(spec)} AS t SET "${spec.column}" = ARRAY(SELECT jsonb_array_elements_text(v.val::jsonb))
             FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS val) AS v WHERE t."_id" = v.id`,
          [ids, values],
        );
      } else {
        const values = rows.map((row) => upgradeStoredPhoneHash(String(row.value)) ?? String(row.value));
        await run(
          `UPDATE ${qualified(spec)} AS t SET "${spec.column}" = v.val
             FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS val) AS v WHERE t."_id" = v.id`,
          [ids, values],
        );
      }
      converted[key] += rows.length;
      lastId = ids[ids.length - 1] as string;
    }
    if (converted[key] > 0) log(`${key}: ${String(converted[key])} filas a ph${String(version)}`);
  }
  return converted;
}
