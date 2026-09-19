/** Verifica contra PostgreSQL que las tablas fueron movidas al schema de dominio esperado. */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildMigrationSequelizeOptions } from '../src/config/database.config.js';
import { ATLAS_DOMAIN_TABLES } from '../src/database/domain-schemas.js';
import { handleUnreachableDatabase } from './gate-skip-policy.js';

type TableRow = { table_schema: string; table_name: string };

async function main(): Promise<void> {
  const sequelize = new Sequelize({ ...buildMigrationSequelizeOptions(), models: [], logging: false });
  try {
    await sequelize.authenticate();
  } catch (error) {
    await sequelize.close().catch(() => undefined);
    handleUnreachableDatabase(error, 'check:domain-schema-layout');
    return;
  }

  const errors: string[] = [];
  try {
    // Se lee `pg_catalog` y NO `information_schema`: las vistas del estándar sólo muestran los objetos
    // sobre los que el rol conectado tiene algún privilegio, así que una tabla que existe pero cuyo
    // dueño es otro rol desaparece de la consulta y este gate la denunciaba como «Falta X» —un
    // diagnóstico rotundo y falso, que además apunta a la migración equivocada—. `pg_class` enumera
    // lo que hay, haya o no privilegios, que es justo la pregunta que hace un gate de LAYOUT.
    // `relkind` cubre tablas normales (`r`) y particionadas (`p`), que es lo que el estándar
    // llamaba `BASE TABLE`; los esquemas internos (`pg_toast`, `pg_temp_*`) se excluyen por prefijo.
    const rows = (await sequelize.query(
      `SELECT n.nspname AS table_schema, c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p')
          AND n.nspname <> 'information_schema'
          AND n.nspname NOT LIKE 'pg\\_%'`,
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
