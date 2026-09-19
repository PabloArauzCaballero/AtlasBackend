/**
 * Impide que la siembra del repositorio lleve identificadores de una base concreta.
 *
 * Por qué existe: entre el 2026-09-17 y el 18, CUATRO despliegues seguidos murieron por la misma
 * causa con cuatro síntomas distintos —`ux_app_content_entries_key` duplicada,
 * `fk_data_providers_default_retention_policy_id`,
 * `decision_artifact_bindings_changed_by_internal_user_id_fkey` y
 * `expediente_concesiones_nodo_id_fkey`—. Todos eran lo mismo: una fila exportada de una base
 * llevaba el `_id` que su referencia tenía ALLÍ, y en cualquier otra base ese número es otro o no
 * existe. Local pasaba siempre, porque local era la base de origen.
 *
 * El gate compara las tablas que la siembra escribe contra sus claves foráneas reales, y falla si
 * una columna que apunta a una tabla que la siembra NO crea lleva un número escrito a mano. Lo que
 * apunta a algo que la propia siembra crea puede llevar número; lo que apunta fuera, no: o se
 * resuelve por clave natural con `refA`, o va a nulo, o el bloque se marca `omitirFilaSiNoResuelve`.
 *
 *   yarn check:seed-references
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { env } from '../src/config/env.js';

const DIRECTORIO = resolve(process.cwd(), 'src/database/seeders/demo');

/** `iam.tenants` se exceptúa: el inquilino 1 lo crean las migraciones y existe en toda instalación. */
const SIEMPRE_PRESENTES = new Set(['iam.tenants']);

function archivosDeSiembra(): { nombre: string; texto: string }[] {
  return readdirSync(DIRECTORIO)
    .filter((nombre) => nombre.endsWith('.ts'))
    .map((nombre) => ({ nombre, texto: readFileSync(join(DIRECTORIO, nombre), 'utf8') }));
}

function tablasQueEscribe(archivos: { texto: string }[]): Set<string> {
  const tablas = new Set<string>();
  for (const { texto } of archivos) {
    for (const coincidencia of texto.matchAll(/tabla:\s*['"]([\w.]+)['"]/g)) tablas.add(coincidencia[1]);
  }
  return tablas;
}

interface ClaveForanea {
  readonly tabla: string;
  readonly columna: string;
  readonly destino: string;
}

async function clavesForaneas(cliente: Client): Promise<ClaveForanea[]> {
  const { rows } = await cliente.query<{ tabla: string; columna: string; destino: string }>(`
    SELECT n.nspname || '.' || t.relname AS tabla,
           a.attname AS columna,
           rn.nspname || '.' || rt.relname AS destino
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_class rt ON rt.oid = c.confrelid
      JOIN pg_namespace rn ON rn.oid = rt.relnamespace
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON TRUE
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE c.contype = 'f'`);
  return rows;
}

async function main(): Promise<void> {
  const archivos = archivosDeSiembra();
  const escribe = tablasQueEscribe(archivos);
  if (escribe.size === 0) {
    console.log('No hay bloques de siembra que revisar.');
    return;
  }

  const cliente = new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_MIGRATION_USER ?? env.DB_USER,
    password: env.DB_MIGRATION_PASSWORD ?? env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } : false,
  });
  await cliente.connect();

  let fks: ClaveForanea[];
  try {
    fks = await clavesForaneas(cliente);
  } finally {
    await cliente.end();
  }

  // Columnas que apuntan FUERA de lo que la siembra crea: ahí un número literal es una bomba.
  const peligrosas = new Set(
    fks.filter((fk) => escribe.has(fk.tabla) && !escribe.has(fk.destino) && !SIEMPRE_PRESENTES.has(fk.destino)).map((fk) => fk.columna),
  );

  const hallazgos: string[] = [];
  for (const { nombre, texto } of archivos) {
    for (const columna of peligrosas) {
      const patron = new RegExp(`['"]?${columna}['"]?:\\s*(\\d+)`, 'g');
      for (const coincidencia of texto.matchAll(patron)) {
        const linea = texto.slice(0, coincidencia.index ?? 0).split('\n').length;
        hallazgos.push(`${nombre}:${linea}  ${columna} = ${coincidencia[1]}`);
      }
    }
  }

  if (hallazgos.length > 0) {
    console.error('❌ La siembra lleva identificadores de otra base en columnas que apuntan fuera de ella:\n');
    for (const hallazgo of hallazgos) console.error(`   ${hallazgo}`);
    console.error(
      '\n   Ese número es válido sólo en la base de la que se exportó. Resuélvelo por clave natural\n' +
        '   con `refA`, déjalo en nulo, o marca el bloque con `omitirFilaSiNoResuelve` si la tabla\n' +
        '   destino puede no existir en una instalación nueva.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `✅ Siembra sin identificadores prestados: ${escribe.size} tablas escritas, ` + `${peligrosas.size} columnas de riesgo revisadas.`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
