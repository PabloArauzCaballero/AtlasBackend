/**
 * Gate de vistas de read_api (Fase 7, §33). Verifica contra un Postgres real que:
 *   1. Las 7 vistas de la primera ola existen en `pg_views` bajo el schema `read_api`.
 *   2. Un smoke `SELECT ... LIMIT 1` ejecuta sin error en cada vista.
 *   3. Imprime un `EXPLAIN (FORMAT JSON)` del feed de auditoría como evidencia para CI.
 *
 * Si no hay conexión a la base, SE SALTA con aviso y termina en 0 (no bloquea entornos sin DB).
 * Con DB presente, cualquier vista faltante o smoke fallido termina en 1.
 *
 * Ejecutar con `yarn check:read-api-views`.
 */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../src/config/database.config.js';

const EXPECTED_VIEWS = [
  'v_customer_overview_v1',
  'v_risk_assessment_summary_v1',
  'v_operations_work_queue_v1',
  'v_provider_health_latest_v1',
  'v_notification_delivery_summary_v1',
  'v_system_endpoint_coverage_v1',
  'v_audit_event_feed_v1',
];

async function main(): Promise<void> {
  const sequelize = new Sequelize({ ...buildSequelizeOptions(), models: [] });

  try {
    await sequelize.authenticate();
  } catch (error) {
    console.warn(`[skip] no se pudo conectar a Postgres: ${(error as Error).message}`);
    await sequelize.close().catch(() => undefined);
    return;
  }

  const errors: string[] = [];
  try {
    const existing = (await sequelize.query(`SELECT viewname FROM pg_views WHERE schemaname = 'read_api' ORDER BY viewname`, {
      type: QueryTypes.SELECT,
    })) as { viewname: string }[];
    const existingNames = new Set(existing.map((row) => row.viewname));

    for (const view of EXPECTED_VIEWS) {
      if (!existingNames.has(view)) {
        errors.push(`Falta la vista read_api.${view} (¿corriste yarn db:migration:up?).`);
        continue;
      }
      try {
        // Smoke: ejecuta la vista sin overfetching (no usa SELECT *).
        await sequelize.query(`SELECT 1 FROM read_api.${view} LIMIT 1`, { type: QueryTypes.SELECT });
        console.log(`[ok] read_api.${view} existe y responde.`);
      } catch (smokeError) {
        errors.push(`read_api.${view} existe pero el smoke SELECT falló: ${(smokeError as Error).message}`);
      }
    }

    if (existingNames.has('v_audit_event_feed_v1')) {
      const plan = (await sequelize.query(
        `EXPLAIN (FORMAT JSON) SELECT source_table, source_id, occurred_at FROM read_api.v_audit_event_feed_v1 ORDER BY occurred_at DESC LIMIT 20`,
        { type: QueryTypes.SELECT },
      )) as Record<string, unknown>[];
      console.log('[explain] read_api.v_audit_event_feed_v1:');
      console.log(JSON.stringify(plan, null, 2));
    }
  } finally {
    await sequelize.close().catch(() => undefined);
  }

  if (errors.length > 0) {
    console.error('❌ Verificación de vistas read_api con errores:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  console.log(`✅ Vistas read_api verificadas (${EXPECTED_VIEWS.length}).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
