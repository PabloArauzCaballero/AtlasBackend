/**
 * Verifica que los seeders de PRODUCCIÓN sean idempotentes (Fase 1 §10 / gate de CI §33/§34).
 *
 * Corre cada seeder de `src/database/seeders/production/` DOS veces seguidas (bypaseando el tracking
 * de Umzug) y comprueba que:
 *   1. La segunda ejecución no lanza (los `ON CONFLICT`/upserts la hacen re-aplicable).
 *   2. No aumentan los conteos de un conjunto de tablas de arranque entre la 1ª y la 2ª pasada
 *      (no se duplican filas).
 *
 * Requiere una base con las migraciones aplicadas. Si no hay conexión, SE SALTA con aviso (exit 0).
 * Debe correr solo contra una base descartable (CI/staging), nunca contra producción real: se niega
 * a ejecutar si `NODE_ENV=production`.
 *
 * Ejecutar con `yarn db:seed:verify-prod-idempotency`.
 */
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { QueryInterface, QueryTypes } from 'sequelize';
import { env } from '../src/config/env.js';
import { createMigrationSequelizeInstance } from '../src/database/sequelize.js';
import { handleUnreachableDatabase } from './gate-skip-policy.js';

const PRODUCTION_DIR = resolve(process.cwd(), 'src', 'database', 'seeders', 'production');

// Tablas de arranque cuyos conteos no deben crecer al re-aplicar los seeders productivos.
const WATCHED_TABLES = [
  'internal_roles',
  'internal_permissions',
  'internal_role_permissions',
  'feature_definitions',
  'risk_policy_rules',
  'risk_ruleset_versions',
  'risk_model_versions',
  'data_providers',
  // Catálogo de flujos: el seeder del árbol de endpoints sincroniza cinco tablas encadenadas, así
  // que un upsert mal escrito duplicaría etapas, pasos o aristas sin que ninguna otra tabla lo note.
  'workflow_definitions',
  'workflow_stages',
  'workflow_steps',
  'workflow_step_dependencies',
  'workflow_transitions',
];

type SeederModule = { up: (args: { context: QueryInterface }) => Promise<void> };

async function countRows(queryInterface: QueryInterface, table: string): Promise<number | null> {
  try {
    const rows = (await queryInterface.sequelize.query(`SELECT count(*)::int AS c FROM ${table}`, {
      type: QueryTypes.SELECT,
    })) as { c: number }[];
    return rows[0]?.c ?? 0;
  } catch {
    return null; // La tabla puede no existir si faltan migraciones; se ignora en el diff.
  }
}

async function snapshot(queryInterface: QueryInterface): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  for (const table of WATCHED_TABLES) {
    result[table] = await countRows(queryInterface, table);
  }
  return result;
}

async function runAllSeeders(queryInterface: QueryInterface, files: string[]): Promise<void> {
  for (const file of files) {
    const moduleUrl = pathToFileURL(join(PRODUCTION_DIR, file)).href;
    const seeder = (await import(moduleUrl)) as SeederModule;
    await seeder.up({ context: queryInterface });
  }
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('verify-prod-seed-idempotency no debe correr con NODE_ENV=production. Úsalo en una base descartable.');
  }

  // Rol de MIGRACIÓN, no el de runtime. Los seeders solo se ejecutan desde `seed.ts`/`seed-runner.ts`,
  // que usan `createMigrationSequelizeInstance()`; verificarlos con `atlas_app_rw` no reproduce las
  // condiciones reales y falla por privilegios que ese rol no tiene a propósito (p. ej. `setval()`
  // sobre una secuencia, que exige UPDATE y no solo USAGE).
  const sequelize = createMigrationSequelizeInstance();
  try {
    try {
      await sequelize.authenticate();
    } catch (error) {
      handleUnreachableDatabase(error, 'db:seed:verify-prod-idempotency');
      return;
    }

    const queryInterface = sequelize.getQueryInterface();
    const files = readdirSync(PRODUCTION_DIR)
      .filter((name) => name.endsWith('.ts'))
      .sort();

    console.log(`[idempotency] Aplicando ${files.length} seeders de producción (pasada 1)...`);
    await runAllSeeders(queryInterface, files);
    const before = await snapshot(queryInterface);

    console.log('[idempotency] Re-aplicando seeders de producción (pasada 2)...');
    await runAllSeeders(queryInterface, files);
    const after = await snapshot(queryInterface);

    const growth = WATCHED_TABLES.filter((table) => before[table] !== null && after[table] !== null && after[table]! > before[table]!).map(
      (table) => `${table}: ${before[table]} -> ${after[table]}`,
    );

    if (growth.length > 0) {
      console.error('❌ Seeders de producción NO idempotentes (se duplicaron filas al re-aplicar):');
      growth.forEach((line) => console.error(`   - ${line}`));
      process.exit(1);
    }

    console.log('✅ Seeders de producción idempotentes: la segunda pasada no lanzó ni duplicó filas.');
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
