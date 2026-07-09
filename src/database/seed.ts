import { QueryTypes } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import { env } from '../config/env.js';
import { createSequelizeInstance } from './sequelize.js';

const sequelize = createSequelizeInstance();
const SEED_RESET_CONFIRMATION = 'ATLAS_DESTROY_SEED_DATA';

const umzug = new Umzug({
  migrations: {
    glob: 'src/database/seeders/*.ts',
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({
    sequelize,
    modelName: 'SequelizeDataSeeders',
  }),
  logger: console,
});

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function cleanDatabaseBeforeSeed(): Promise<void> {
  if (!env.DATABASE_CLEAN_BEFORE_SEED) return;

  if (env.NODE_ENV === 'production') {
    const productionResetAllowed = env.DATABASE_CLEAN_ALLOW_PRODUCTION && env.DATABASE_CLEAN_CONFIRM === SEED_RESET_CONFIRMATION;
    if (!productionResetAllowed) {
      throw new Error(
        'DATABASE_CLEAN_BEFORE_SEED=true fue solicitado en producción, pero falta la doble confirmación. ' +
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
      'Se preserva SequelizeMeta y se limpia SequelizeDataSeeders para recargar seeds.',
  );
  await sequelize.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
  console.log('[seed:clean] Limpieza completada. Ejecutando seeders desde cero.');
}

async function run(): Promise<void> {
  const command = process.argv[2];

  try {
    if (command === 'up') {
      await cleanDatabaseBeforeSeed();
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

    throw new Error(`Comando de seed no soportado: ${command ?? '(vacío)'}`);
  } finally {
    await sequelize.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
