/**
 * Extrae el inventario de workload de LECTURA (Fase 0, §26) desde el catálogo de sistemas: para cada
 * endpoint read-only, lista su módulo, riesgo y las tablas/entidades que impacta.
 *
 * Se usa para llenar `docs/database/read-workload-inventory.md` con datos reales en vez de intuición.
 * Si no hay conexión a Postgres, SE SALTA con aviso (exit 0).
 *
 * Ejecutar con `yarn db:extract-read-workload`.
 */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../src/config/database.config.js';

interface WorkloadRow {
  method: string;
  full_path: string;
  module: string;
  risk_level: string;
  entity_count: number;
  tables: string[] | null;
}

async function main(): Promise<void> {
  const sequelize = new Sequelize({ ...buildSequelizeOptions(), models: [] });

  try {
    await sequelize.authenticate();
  } catch (error) {
    console.warn(`[skip] no se pudo conectar a Postgres: ${(error as Error).message}`);
    await sequelize.close().catch(() => undefined);
    return;
  }

  try {
    const rows = (await sequelize.query(
      `SELECT
         e.method,
         e.full_path,
         e.module,
         e.risk_level,
         count(i._id) AS entity_count,
         array_agg(DISTINCT d.table_name) FILTER (WHERE d.table_name IS NOT NULL) AS tables
       FROM system_endpoint_catalog e
       LEFT JOIN system_endpoint_data_entity_impacts i ON i.endpoint_id = e._id
       LEFT JOIN system_data_entity_catalog d ON d._id = i.data_entity_id
       WHERE e.is_readonly = true
       GROUP BY e._id, e.method, e.full_path, e.module, e.risk_level
       ORDER BY e.module, e.full_path`,
      { type: QueryTypes.SELECT },
    )) as WorkloadRow[];

    if (rows.length === 0) {
      console.log('[info] No hay endpoints read-only en system_endpoint_catalog (¿corriste los seeders?).');
      return;
    }

    console.log('| Endpoint | Módulo | Riesgo | # entidades | Tablas fuente |');
    console.log('| -------- | ------ | ------ | ----------- | ------------- |');
    for (const row of rows) {
      const tables = (row.tables ?? []).join(', ');
      console.log(`| \`${row.method} ${row.full_path}\` | ${row.module} | ${row.risk_level} | ${row.entity_count} | ${tables} |`);
    }
    console.log(`\n[info] ${rows.length} endpoints de lectura inventariados. Pega esta tabla en docs/database/read-workload-inventory.md.`);
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
