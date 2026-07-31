/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Umzug, SequelizeStorage } from 'umzug';
import { createMigrationSequelizeInstance } from './sequelize.js';

const sequelize = createMigrationSequelizeInstance();

// Mismo criterio que `seed-runner.ts`: por CLI (`yarn db:migration:up`, vía tsx) este archivo vive
// en `src/database/` y las migraciones son `.ts`; en la imagen de producción vive en
// `dist/src/database/` y son `.js`. El glob anterior era la ruta literal `src/database/migrations/*.ts`,
// que dependía del CWD y, sobre todo, apuntaba a fuentes TypeScript que la imagen no puede importar
// (`tsx` es una devDependency y no viaja en ella): correr las migraciones como job de despliegue con
// esa misma imagen era imposible. Resolver desde `__dirname` funciona en los dos entornos.
const RUNNER_DIR = __dirname;
const MIGRATION_EXT = /(^|[\\/])dist([\\/])/.test(RUNNER_DIR) ? 'js' : 'ts';

// El nombre CANÓNICO con el que se registra cada migración en `SequelizeMeta` es siempre `.ts`, sin
// importar cómo se ejecute. Sin esto, una migración aplicada por CLI se volvería a aplicar al correr
// el runner compilado, porque el tracking la vería con otro nombre.
const canonicalName = (name: string): string => name.replace(/\.js$/, '.ts');

type MigrationModule = {
  up: (params: { context: unknown }) => Promise<void>;
  down: (params: { context: unknown }) => Promise<void>;
};

/** Carga por `import()` de una URL de archivo: funciona igual para el `.ts` de tsx y el `.js` compilado. */
async function loadMigration(path: string): Promise<MigrationModule> {
  const imported = (await import(pathToFileURL(path).href)) as Partial<MigrationModule> & { default?: Partial<MigrationModule> };
  const up = imported.up ?? imported.default?.up;
  const down = imported.down ?? imported.default?.down;
  if (typeof up !== 'function' || typeof down !== 'function') {
    throw new Error(`La migración ${path} no exporta up/down.`);
  }
  return { up, down };
}

const umzug = new Umzug({
  migrations: {
    glob: join(RUNNER_DIR, 'migrations', `*.${MIGRATION_EXT}`).replace(/\\/g, '/'),
    resolve: ({ name, path, context }) => ({
      name: canonicalName(name),
      up: async () => (await loadMigration(path as string)).up({ context }),
      down: async () => (await loadMigration(path as string)).down({ context }),
    }),
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});

async function run(): Promise<void> {
  const command = process.argv[2];

  try {
    if (command === 'up') {
      await umzug.up();
      return;
    }

    if (command === 'down') {
      await umzug.down();
      return;
    }

    if (command === 'status') {
      const executed = await umzug.executed();
      const pending = await umzug.pending();

      console.log(JSON.stringify({ executed, pending }, null, 2));
      return;
    }

    throw new Error(`Comando de migración no soportado: ${command ?? '(vacío)'}`);
  } finally {
    await sequelize.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
