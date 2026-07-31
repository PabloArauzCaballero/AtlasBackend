/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryTypes } from 'sequelize';
import { env } from '../config/env.js';
import { ATLAS_SCHEMAS } from './domain-schemas.js';
import { assertProfileAllowedForEnv, assertReseedAllowed, resolveSeedProfile, SEED_PROFILE_STAGES, SeedProfile } from './seed-profiles.js';
import { buildStageRunner, runProfileSeedersUp } from './seed-runner.js';
import { createMigrationSequelizeInstance } from './sequelize.js';

const sequelize = createMigrationSequelizeInstance();
const SEED_RESET_CONFIRMATION = 'ATLAS_DESTROY_SEED_DATA';

function parseProfileFlag(argv: string[]): string | null {
  const flag = argv.find((arg) => arg.startsWith('--profile='));
  if (flag) return flag.slice('--profile='.length);
  const index = argv.indexOf('--profile');
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return null;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function cleanDatabaseBeforeSeed(profile: SeedProfile): Promise<void> {
  if (!env.DATABASE_CLEAN_BEFORE_SEED) return;
  await truncateApplicationTables(profile);
}

/**
 * `reseed` (a diferencia de `up`, que solo corre seeders nunca ejecutados): comando idempotente
 * pero destructivo para refrescar TODO el catálogo de seeds del perfil desde cero. Existe porque no
 * todos los seeders demo/dev son upsert-safe; truncar + limpiar el tracking y recargar es la forma
 * segura de reconstruir un entorno descartable. Está PROHIBIDO para el perfil production (§8, §41).
 */
async function truncateApplicationTables(profile: SeedProfile): Promise<void> {
  assertReseedAllowed(profile);

  if (env.NODE_ENV === 'production') {
    const productionResetAllowed = env.DATABASE_CLEAN_ALLOW_PRODUCTION && env.DATABASE_CLEAN_CONFIRM === SEED_RESET_CONFIRMATION;
    if (!productionResetAllowed) {
      throw new Error(
        'Se solicitó truncar datos con NODE_ENV=production, pero falta la doble confirmación. ' +
          `Configura DATABASE_CLEAN_ALLOW_PRODUCTION=true y DATABASE_CLEAN_CONFIRM=${SEED_RESET_CONFIRMATION} solo si realmente vas a destruir datos semilla/de prueba.`,
      );
    }
  }

  const schemas = Object.values(ATLAS_SCHEMAS);
  const tables = await sequelize.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema IN (:schemas)
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name;`,
    { replacements: { schemas }, type: QueryTypes.SELECT },
  );

  if (tables.length === 0) {
    console.log(`[seed:clean] No hay tablas de aplicación para limpiar en los schemas ${schemas.join(', ')}.`);
    return;
  }

  const tableList = tables.map((row) => `${quoteIdentifier(row.table_schema)}.${quoteIdentifier(row.table_name)}`).join(', ');
  console.warn(
    `[seed:clean] Limpiando ${tables.length} tablas de aplicación en ${schemas.length} schemas de dominio. ` +
      'Se preservan SequelizeMeta y las tablas de tracking de seeders en public.',
  );
  await sequelize.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
  console.log('[seed:clean] Limpieza completada. Ejecutando seeders desde cero.');
}

async function commandUp(profile: SeedProfile): Promise<void> {
  await cleanDatabaseBeforeSeed(profile);
  const evidence = await runProfileSeedersUp(sequelize, profile);
  console.log(JSON.stringify({ command: 'up', profile, appliedByStage: evidence, appliedAt: new Date().toISOString() }, null, 2));
}

async function commandReseed(profile: SeedProfile): Promise<void> {
  assertReseedAllowed(profile);
  await truncateApplicationTables(profile);
  const evidence = await runProfileSeedersUp(sequelize, profile);
  console.log(JSON.stringify({ command: 'reseed', profile, appliedByStage: evidence, appliedAt: new Date().toISOString() }, null, 2));
}

async function commandDown(profile: SeedProfile): Promise<void> {
  // Revierte el último seeder aplicado del stage más específico del perfil que tenga ejecutados.
  for (const stage of [...SEED_PROFILE_STAGES[profile]].reverse()) {
    const runner = buildStageRunner(sequelize, stage);
    const executed = await runner.umzug.executed();
    if (executed.length > 0) {
      const reverted = await runner.umzug.down();
      console.log(JSON.stringify({ command: 'down', profile, stage: stage.directory, reverted: reverted.map((m) => m.name) }, null, 2));
      return;
    }
  }
  console.log(JSON.stringify({ command: 'down', profile, reverted: [], note: 'No hay seeders ejecutados para revertir.' }, null, 2));
}

async function commandStatus(profile: SeedProfile): Promise<void> {
  const stages = [];
  for (const stage of SEED_PROFILE_STAGES[profile]) {
    const runner = buildStageRunner(sequelize, stage);
    const executed = await runner.umzug.executed();
    const pending = await runner.umzug.pending();
    stages.push({
      directory: stage.directory,
      trackingTable: stage.trackingModelName,
      executed: executed.map((migration) => migration.name),
      pending: pending.map((migration) => migration.name),
    });
  }
  console.log(JSON.stringify({ profile, stages }, null, 2));
}

async function run(): Promise<void> {
  const command = process.argv[2];
  const profile = resolveSeedProfile({
    explicit: parseProfileFlag(process.argv.slice(3)),
    envProfile: env.SEED_PROFILE ?? null,
    nodeEnv: env.NODE_ENV,
  });
  assertProfileAllowedForEnv(profile, env.NODE_ENV);

  try {
    if (command === 'up') return await commandUp(profile);
    if (command === 'down') return await commandDown(profile);
    if (command === 'reseed') return await commandReseed(profile);
    if (command === 'status') return await commandStatus(profile);
    throw new Error(`Comando de seed no soportado: ${command ?? '(vacío)'}. Usa up | down | status | reseed [--profile=...].`);
  } finally {
    await sequelize.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
