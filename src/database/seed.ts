/**
 * @file Trae a esta base el conjunto sembrado publicado por la rama de semillas.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Client } from 'pg';
import { env } from '../config/env.js';
import { applyLocalIdentityOverrides } from './seed-local-identities.js';
import { requireSeedSource } from './seed-source.js';
import { listSeededTables, syncSeedData } from './seed-sync.js';

/**
 * Sustituye al antiguo runner de seeders versionados (`db:seed:up|down|reseed --profile=...`).
 *
 * El perfil ya no es un argumento del comando sino la RAMA a la que apunta `SEED_SOURCE_*`: la de
 * desarrollo publica también los usuarios y comercios de prueba, la de producción sólo el dato
 * maestro. Un comando menos que equivocarse, y —a diferencia de un `--profile`— no hay forma de
 * pedirle a la rama de producción que entregue fixtures que no tiene.
 *
 *   yarn db:seed:pull     copia el conjunto publicado a esta base (DESTRUCTIVO sobre esas tablas)
 *   yarn db:seed:status    compara lo publicado con lo que hay aquí, sin escribir nada
 */

function targetClient(): Client {
  // Se conecta con la identidad de MIGRACIÓN: la carga retira y recrea claves foráneas, que es DDL,
  // y el rol de runtime (`atlas_app_rw`) deliberadamente no puede hacerlo.
  return new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_MIGRATION_USER ?? env.DB_USER,
    password: env.DB_MIGRATION_PASSWORD ?? env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } : false,
  });
}

function sourceClient(): { client: Client; describe: string } {
  const source = requireSeedSource();
  return { client: new Client({ connectionString: source.connectionString, ssl: source.ssl }), describe: source.describe };
}

async function commandPull(): Promise<void> {
  const { client: source, describe } = sourceClient();
  const target = targetClient();
  await source.connect();
  await target.connect();

  try {
    console.log(`Rama de semillas: ${describe}`);
    console.log(`Destino:          ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}\n`);
    const result = await syncSeedData({ source, target });

    // Las credenciales propias de la máquina se reaplican DESPUÉS de la copia y sólo fuera de
    // producción; ver seed-local-identities.ts.
    const overrides =
      env.NODE_ENV === 'production'
        ? { applied: [] }
        : await applyLocalIdentityOverrides(target, {
            adminEmail: env.DEV_ADMIN_EMAIL,
            adminPassword: env.DEV_ADMIN_PASSWORD,
            partnerPassword: env.DEV_PARTNER_PASSWORD,
          });

    console.log(
      `\n${JSON.stringify(
        { command: 'pull', source: describe, ...result, localOverrides: overrides.applied, pulledAt: new Date().toISOString() },
        null,
        2,
      )}`,
    );
  } finally {
    await source.end();
    await target.end();
  }
}

async function commandStatus(): Promise<void> {
  const { client: source, describe } = sourceClient();
  const target = targetClient();
  await source.connect();
  await target.connect();

  try {
    const published = await listSeededTables(source);
    const local = new Map((await listSeededTables(target)).map((table) => [`${table.schema}.${table.name}`, table.rows]));

    const differences = published
      .map((table) => ({
        tabla: `${table.schema}.${table.name}`,
        publicado: table.rows,
        local: local.get(`${table.schema}.${table.name}`) ?? 0,
      }))
      .filter((row) => row.publicado !== row.local);

    console.log(
      JSON.stringify(
        {
          source: describe,
          target: `${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`,
          publishedTables: published.length,
          publishedRows: published.reduce((total, table) => total + table.rows, 0),
          differences,
          inSync: differences.length === 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await source.end();
    await target.end();
  }
}

async function run(): Promise<void> {
  const command = process.argv[2] ?? 'pull';
  if (command === 'pull') return commandPull();
  if (command === 'status') return commandStatus();
  throw new Error(`Comando de seed no soportado: ${command}. Usa pull | status.`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
