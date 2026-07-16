/**
 * Captura el baseline de consultas (Fase 0, §26) desde `pg_stat_statements`: top de queries por
 * tiempo total, media, filas y buffers. Se usa para llenar `docs/database/query-baseline.md`.
 *
 * Requiere la extensión `pg_stat_statements`. Si no está instalada o no hay conexión, SE SALTA con
 * aviso (exit 0) — no bloquea entornos que no la tengan.
 *
 * Ejecutar con `yarn db:capture-query-baseline`.
 */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../src/config/database.config.js';

interface StatementRow {
  calls: string;
  total_exec_time: number;
  mean_exec_time: number;
  rows: string;
  shared_blks_hit: string;
  shared_blks_read: string;
  query: string;
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
    const ext = (await sequelize.query(`SELECT 1 AS ok FROM pg_extension WHERE extname = 'pg_stat_statements'`, {
      type: QueryTypes.SELECT,
    })) as { ok: number }[];

    if (ext.length === 0) {
      console.warn('[skip] la extensión pg_stat_statements no está instalada. Habilítala en staging para capturar el baseline.');
      return;
    }

    const rows = (await sequelize.query(
      `SELECT calls, total_exec_time, mean_exec_time, rows, shared_blks_hit, shared_blks_read, query
       FROM pg_stat_statements
       ORDER BY total_exec_time DESC
       LIMIT 25`,
      { type: QueryTypes.SELECT },
    )) as StatementRow[];

    console.log('| # | Llamadas | total_time (ms) | mean_time (ms) | rows | hit/read | Query |');
    console.log('| - | -------- | --------------- | -------------- | ---- | -------- | ----- |');
    rows.forEach((row, index) => {
      const query = row.query.replace(/\s+/g, ' ').slice(0, 90);
      const hitRead = `${row.shared_blks_hit}/${row.shared_blks_read}`;
      console.log(
        `| ${index + 1} | ${row.calls} | ${row.total_exec_time.toFixed(1)} | ${row.mean_exec_time.toFixed(2)} | ${row.rows} | ${hitRead} | \`${query}\` |`,
      );
    });
    console.log(`\n[info] Top ${rows.length} consultas por tiempo total. Pega esta tabla en docs/database/query-baseline.md.`);
  } catch (error) {
    console.warn(`[skip] no se pudo leer pg_stat_statements (¿versión de columnas distinta?): ${(error as Error).message}`);
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
