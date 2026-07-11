import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * `SystemsActionLogRepository.getTrafficLatencyByRoute`/`getTrafficLatencyTimeseries`
 * (dashboards de tráfico/latencia de systems-ops) filtran por `occurred_at >= :fromDate` y
 * agregan `duration_ms`/`response_status_code` agrupando por `route_template`/`method` o por
 * bucket de tiempo. El único índice existente sobre esa columna
 * (`ix_system_action_logs_occurred`) solo cubre `occurred_at` — Postgres hace index scan por esa
 * columna y después va al heap por cada fila del rango para leer el resto. Este índice agrega
 * las columnas que esas dos queries realmente necesitan como columnas `INCLUDE` (no forman parte
 * de la clave de búsqueda, así que no afectan el orden del índice), permitiendo un index-only
 * scan a medida que la tabla crezca.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_system_action_logs_occurred_covering_traffic
  ON system_action_logs(occurred_at)
  INCLUDE (duration_ms, route_template, method, response_status_code);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ix_system_action_logs_occurred_covering_traffic;
`);
}
