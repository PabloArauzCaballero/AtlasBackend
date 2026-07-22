/** Verifica contra PostgreSQL que las tablas fueron movidas al schema de dominio esperado. */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildMigrationSequelizeOptions } from '../src/config/database.config.js';
import { ATLAS_DOMAIN_TABLES } from '../src/database/domain-schemas.js';

type TableRow = { table_schema: string; table_name: string };

async function main(): Promise<void> {
  const sequelize = new Sequelize({ ...buildMigrationSequelizeOptions(), models: [], logging: false });
  try {
    await sequelize.authenticate();
  } catch (error) {
    console.warn(`[skip] no se pudo conectar a PostgreSQL: ${(error as Error).message}`);
    await sequelize.close().catch(() => undefined);
    return;
  }

  const errors: string[] = [];
  try {
    const rows = (await sequelize.query(
      `SELECT table_schema, table_name
         FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')`,
      { type: QueryTypes.SELECT },
    )) as TableRow[];
    const locations = new Set(rows.map((row) => `${row.table_schema}.${row.table_name}`));

    for (const [schema, tables] of Object.entries(ATLAS_DOMAIN_TABLES)) {
      for (const table of tables) {
        if (!locations.has(`${schema}.${table}`)) errors.push(`Falta ${schema}.${table}.`);
        if (locations.has(`public.${table}`)) errors.push(`Persistió la tabla de negocio public.${table}.`);
      }
    }

    const unexpectedPublic = rows
      .filter((row) => row.table_schema === 'public' && !/^Sequelize(?:Meta|DataSeeders)/.test(row.table_name))
      .map((row) => row.table_name);
    if (unexpectedPublic.length > 0) {
      errors.push(`Tablas no permitidas en public: ${unexpectedPublic.join(', ')}.`);
    }
  } finally {
    await sequelize.close().catch(() => undefined);
  }

  if (errors.length > 0) {
    console.error('❌ Layout físico de schemas inválido:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  console.log('✅ Todas las tablas de negocio están en su schema de dominio y public solo contiene tracking de infraestructura.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
