import { QueryTypes } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import { env } from '../config/env.js';
import {
  assertProfileAllowedForEnv,
  assertReseedAllowed,
  findForbiddenProductionTokens,
  FORBIDDEN_PRODUCTION_FILENAME_TOKENS,
  resolveSeedProfile,
  SEED_PROFILE_STAGES,
  SeedProfile,
  SeedStage,
} from './seed-profiles.js';
import { createSequelizeInstance } from './sequelize.js';

const sequelize = createSequelizeInstance();
const SEED_RESET_CONFIRMATION = 'ATLAS_DESTROY_SEED_DATA';

type StageRunner = {
  stage: SeedStage;
  umzug: Umzug<ReturnType<typeof sequelize.getQueryInterface>>;
};

function buildStageRunner(stage: SeedStage): StageRunner {
  const umzug = new Umzug({
    migrations: {
      glob: `src/database/seeders/${stage.directory}/*.ts`,
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, modelName: stage.trackingModelName }),
    logger: console,
  });
  return { stage, umzug };
}

function parseProfileFlag(argv: string[]): string | null {
  const flag = argv.find((arg) => arg.startsWith('--profile='));
  if (flag) return flag.slice('--profile='.length);
  const index = argv.indexOf('--profile');
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return null;
}

/**
 * Guard de arranque productivo (§11): ningún seeder del directorio `production` puede llamarse con
 * tokens de datos ficticios (`demo`, `dev`, `fixture`, `mock`, `sample`). Es defensa en profundidad
 * frente a `scripts/check-seed-profile.ts`, que hace el mismo escaneo estático en CI.
 */
async function assertProductionStageIsClean(runner: StageRunner): Promise<void> {
  if (runner.stage.directory !== 'production') return;
  const [pending, executed] = await Promise.all([runner.umzug.pending(), runner.umzug.executed()]);
  const offenders = [...pending, ...executed]
    .map((migration) => migration.name)
    .filter((name) => findForbiddenProductionTokens(name).length > 0);
  if (offenders.length > 0) {
    throw new Error(
      `Seeders de arranque productivo con nombres prohibidos detectados en src/database/seeders/production/: ` +
        `${offenders.join(', ')}. Los tokens ${FORBIDDEN_PRODUCTION_FILENAME_TOKENS.join('/')} indican datos ` +
        'de desarrollo/demo y no pueden vivir en el perfil production.',
    );
  }
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

  const schema = env.DB_SCHEMA;
  const tables = await sequelize.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = :schema
        AND table_type = 'BASE TABLE'
        AND table_name <> 'SequelizeMeta'
      ORDER BY table_name;`,
    { replacements: { schema }, type: QueryTypes.SELECT },
  );

  if (tables.length === 0) {
    console.log(`[seed:clean] No hay tablas de aplicación para limpiar en schema ${schema}.`);
    return;
  }

  const tableList = tables.map((row) => `${quoteIdentifier(schema)}.${quoteIdentifier(row.table_name)}`).join(', ');
  console.warn(
    `[seed:clean] Limpiando ${tables.length} tablas de aplicación en schema ${schema}. ` +
      'Se preserva SequelizeMeta y se limpian las tablas de tracking de seeders para recargar todos los perfiles.',
  );
  await sequelize.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
  console.log('[seed:clean] Limpieza completada. Ejecutando seeders desde cero.');
}

async function commandUp(profile: SeedProfile): Promise<void> {
  await cleanDatabaseBeforeSeed(profile);
  const evidence: Record<string, string[]> = {};
  for (const stage of SEED_PROFILE_STAGES[profile]) {
    const runner = buildStageRunner(stage);
    await assertProductionStageIsClean(runner);
    const applied = await runner.umzug.up();
    evidence[stage.directory] = applied.map((migration) => migration.name);
  }
  console.log(JSON.stringify({ command: 'up', profile, appliedByStage: evidence, appliedAt: new Date().toISOString() }, null, 2));
}

async function commandReseed(profile: SeedProfile): Promise<void> {
  assertReseedAllowed(profile);
  await truncateApplicationTables(profile);
  const evidence: Record<string, string[]> = {};
  for (const stage of SEED_PROFILE_STAGES[profile]) {
    const runner = buildStageRunner(stage);
    await assertProductionStageIsClean(runner);
    const applied = await runner.umzug.up();
    evidence[stage.directory] = applied.map((migration) => migration.name);
  }
  console.log(JSON.stringify({ command: 'reseed', profile, appliedByStage: evidence, appliedAt: new Date().toISOString() }, null, 2));
}

async function commandDown(profile: SeedProfile): Promise<void> {
  // Revierte el último seeder aplicado del stage más específico del perfil que tenga ejecutados.
  for (const stage of [...SEED_PROFILE_STAGES[profile]].reverse()) {
    const runner = buildStageRunner(stage);
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
    const runner = buildStageRunner(stage);
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
