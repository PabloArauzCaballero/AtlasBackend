import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import { env } from '../config/env.js';
import {
  assertProfileAllowedForEnv,
  findForbiddenProductionTokens,
  FORBIDDEN_PRODUCTION_FILENAME_TOKENS,
  resolveSeedProfile,
  SEED_PROFILE_STAGES,
  SeedProfile,
  SeedStage,
} from './seed-profiles.js';
import { createMigrationSequelizeInstance } from './sequelize.js';

/**
 * Núcleo reutilizable del runner de seeds: aplica los seeders `up` (idempotente vía Umzug — solo
 * corre los pendientes) de un perfil. Lo usan tanto el CLI (`seed.ts`) como el seeding automático
 * al arrancar (`startup-seed.service.ts`), para no duplicar la lógica de stages/guards.
 */

type StageRunner = {
  stage: SeedStage;
  umzug: Umzug<ReturnType<Sequelize['getQueryInterface']>>;
};

// Glob de seeders RELATIVO AL MÓDULO y consciente del entorno: bajo tsx (CLI `yarn db:seed:*`) este
// archivo vive en `src/database/` y los seeders son `.ts`; compilado a CommonJS (`node dist/src/main.js`,
// que es como corre el backend incl. `start:dev`) vive en `dist/src/database/` y son `.js`. Usar una
// ruta absoluta desde `__dirname` evita depender del CWD y funciona en ambos entornos.
const RUNNER_DIR = __dirname;
const SEEDER_EXT = /(^|[\\/])dist([\\/])/.test(RUNNER_DIR) ? 'js' : 'ts';

function seederGlob(directory: string): string {
  return join(RUNNER_DIR, 'seeders', directory, `*.${SEEDER_EXT}`).replace(/\\/g, '/');
}

type SeederModule = {
  up: (params: { context: unknown }) => Promise<void>;
  down: (params: { context: unknown }) => Promise<void>;
};

/**
 * Nombre CANÓNICO del seeder para el tracking: siempre con extensión `.ts`, sin importar si el
 * archivo real es `.ts` (tsx/CLI) o `.js` (compilado/arranque). Sin esto, el mismo seeder se
 * trackearía con dos nombres distintos según cómo se ejecute y el runner compilado re-correría lo
 * que el CLI ya aplicó. La base ya tiene nombres `.ts` (sembrada por el CLI), así que se preserva.
 */
function canonicalSeederName(name: string): string {
  return name.replace(/\.js$/i, '.ts');
}

async function loadSeederModule(path: string): Promise<SeederModule> {
  const imported = (await import(pathToFileURL(path).href)) as Partial<SeederModule> & { default?: Partial<SeederModule> };
  const up = imported.up ?? imported.default?.up;
  const down = imported.down ?? imported.default?.down;
  if (typeof up !== 'function' || typeof down !== 'function') {
    throw new Error(`El seeder ${path} no exporta up/down.`);
  }
  return { up, down };
}

export function buildStageRunner(sequelize: Sequelize, stage: SeedStage): StageRunner {
  const umzug = new Umzug({
    migrations: {
      glob: seederGlob(stage.directory),
      // Nombre canónico `.ts` + carga por import() (universal CJS/ESM), para que el tracking sea
      // idéntico corriendo por CLI (tsx, `.ts`) o al arrancar (compilado, `.js`).
      resolve: ({ name, path, context }) => ({
        name: canonicalSeederName(name),
        up: async () => (await loadSeederModule(path as string)).up({ context }),
        down: async () => (await loadSeederModule(path as string)).down({ context }),
      }),
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, modelName: stage.trackingModelName }),
    logger: console,
  });
  return { stage, umzug };
}

/**
 * Guard de arranque productivo: ningún seeder del directorio `production` puede llamarse con tokens
 * de datos ficticios (`demo`, `dev`, `fixture`, `mock`, `sample`). Defensa en profundidad frente a
 * `scripts/check-seed-profile.ts`.
 */
export async function assertProductionStageIsClean(runner: StageRunner): Promise<void> {
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

/** Aplica los seeders `up` de todos los stages del perfil. Devuelve los aplicados por stage. */
export async function runProfileSeedersUp(sequelize: Sequelize, profile: SeedProfile): Promise<Record<string, string[]>> {
  const appliedByStage: Record<string, string[]> = {};
  for (const stage of SEED_PROFILE_STAGES[profile]) {
    const runner = buildStageRunner(sequelize, stage);
    await assertProductionStageIsClean(runner);
    const applied = await runner.umzug.up();
    appliedByStage[stage.directory] = applied.map((migration) => migration.name);
  }
  return appliedByStage;
}

export type StartupSeedResult = {
  profile: SeedProfile;
  appliedByStage: Record<string, string[]>;
  totalApplied: number;
};

/**
 * Punto de entrada del seeding automático al arrancar. Resuelve el perfil desde SEED_PROFILE/NODE_ENV
 * (production→production, test→test, resto→development), valida que el perfil esté permitido para el
 * entorno, y aplica los seeders pendientes de forma idempotente usando la identidad de migración
 * (DB_MIGRATION_USER, cae a DB_USER en local). Crea y cierra su propia conexión para no interferir
 * con el pool de runtime del backend.
 */
export async function seedOnStartup(): Promise<StartupSeedResult> {
  const profile = resolveSeedProfile({ envProfile: env.SEED_PROFILE ?? null, nodeEnv: env.NODE_ENV });
  assertProfileAllowedForEnv(profile, env.NODE_ENV);

  const sequelize = createMigrationSequelizeInstance();
  try {
    const appliedByStage = await runProfileSeedersUp(sequelize, profile);
    const totalApplied = Object.values(appliedByStage).reduce((sum, names) => sum + names.length, 0);
    return { profile, appliedByStage, totalApplied };
  } finally {
    await sequelize.close();
  }
}
