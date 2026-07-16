import { QueryInterface } from 'sequelize';

/**
 * Migración aditiva: crea una vista (`audit_event_feed`) que unifica por `UNION ALL`
 * las 7 tablas fuente que hoy alimenta `AuditRepository` (`operational_audit_logs`,
 * `data_change_logs`, `auth_events`, `consent_events`, `customer_action_logs`,
 * `customer_status_events`, `fraud_case_events`, `manual_review_events`), permitiendo un
 * cursor real `(occurred_at, source_table, source_id)` sobre las 8 fuentes en vez del patrón
 * "pedir offset+limit de cada tabla y recortar en memoria" que usa `AuditRepository` hoy.
 *
 * NO modifica ninguna tabla existente ni la migración inicial ya aplicada
 * (`20260626154044-...`): es estrictamente `CREATE VIEW` + `CREATE INDEX IF NOT EXISTS` sobre
 * columnas que ya existen. `down()` revierte de forma limpia (`DROP VIEW`, sin tocar las tablas
 * fuente ni sus índices, que pueden ser útiles independientemente de la vista).
 *
 * Se usa una vista simple (no materializada) a propósito: una vista materializada requeriría
 * `REFRESH` manual y por lo tanto datos de auditoría con staleness — inaceptable para un feed
 * de auditoría/cumplimiento que debe reflejar el estado real en todo momento. Postgres puede
 * empujar `WHERE tenant_id = ... AND occurred_at < ...` y el `ORDER BY ... LIMIT` a cada rama
 * del `UNION ALL` cuando existe un índice compuesto `(tenant_id, timestamp DESC, id DESC)` por
 * tabla fuente — por eso esta migración también asegura esos índices con `IF NOT EXISTS` en
 * vez de asumir que ya existen.
 *
 * Validación operativa recomendada después de aplicar la migración:
 *   `SELECT COUNT(*) FROM audit_event_feed;` (debe coincidir con la suma de conteos de las 8
 *   tablas fuente) y `EXPLAIN ANALYZE SELECT * FROM audit_event_feed WHERE tenant_id = 1 ORDER
 *   BY occurred_at DESC, source_id DESC LIMIT 20;` (debe mostrar índices, no seq scans, en cada
 *   rama del plan).
 */
export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const sequelize = queryInterface.sequelize;

  await sequelize.query(`
    CREATE OR REPLACE VIEW audit_event_feed AS
    SELECT
      'operational_audit_log'::text AS source_table,
      _id::text AS source_id,
      _tenant_id AS tenant_id,
      occurred_at AS occurred_at,
      actor_type AS actor_type,
      action_code AS event_type,
      target_type AS target_type,
      target_id AS target_id,
      payload_json AS payload_json
    FROM operational_audit_logs

    UNION ALL

    SELECT
      'data_change_log'::text,
      _id::text,
      _tenant_id,
      changed_at,
      changed_by_type,
      change_type,
      table_name,
      record_id,
      NULL::jsonb
    FROM data_change_logs

    UNION ALL

    SELECT
      'auth_event'::text,
      _id::text,
      _tenant_id,
      occurred_at,
      'customer'::varchar(40),
      event_type,
      'customer'::varchar(120),
      customer_id::text,
      NULL::jsonb
    FROM auth_events

    UNION ALL

    SELECT
      'consent_event'::text,
      _id::text,
      _tenant_id,
      happened_at,
      triggered_by_type,
      event_type,
      'customer_consent'::varchar(120),
      customer_consent_id::text,
      NULL::jsonb
    FROM consent_events

    UNION ALL

    SELECT
      'customer_action_log'::text,
      _id::text,
      _tenant_id,
      occurred_at,
      'customer'::varchar(40),
      event_name,
      'customer'::varchar(120),
      customer_id::text,
      action_payload_json
    FROM customer_action_logs

    UNION ALL

    SELECT
      'customer_status_event'::text,
      _id::text,
      _tenant_id,
      happened_at,
      changed_by_type,
      'status_change'::varchar(120),
      'customer'::varchar(120),
      customer_id::text,
      NULL::jsonb
    FROM customer_status_events

    UNION ALL

    SELECT
      'fraud_case_event'::text,
      _id::text,
      _tenant_id,
      happened_at,
      actor_type,
      event_type,
      'fraud_case'::varchar(120),
      fraud_case_id::text,
      payload_json
    FROM fraud_case_events

    UNION ALL

    SELECT
      'manual_review_event'::text,
      _id::text,
      _tenant_id,
      happened_at,
      actor_type,
      event_type,
      'manual_review_case'::varchar(120),
      manual_review_case_id::text,
      payload_json
    FROM manual_review_events;
  `);

  // Índices defensivos (IF NOT EXISTS): cubren el orden `(tenant_id, timestamp DESC, id DESC)`
  // que la vista necesita para que cada rama del UNION ALL pueda resolverse con un index scan
  // en vez de un seq scan cuando se filtra por tenant y se ordena por tiempo.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_operational_audit_logs_tenant_occurred ON operational_audit_logs (_tenant_id, occurred_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_data_change_logs_tenant_changed ON data_change_logs (_tenant_id, changed_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_auth_events_tenant_occurred ON auth_events (_tenant_id, occurred_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_consent_events_tenant_happened ON consent_events (_tenant_id, happened_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_customer_action_logs_tenant_occurred ON customer_action_logs (_tenant_id, occurred_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_customer_status_events_tenant_happened ON customer_status_events (_tenant_id, happened_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_fraud_case_events_tenant_happened ON fraud_case_events (_tenant_id, happened_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_manual_review_events_tenant_happened ON manual_review_events (_tenant_id, happened_at DESC, _id DESC);`,
  );
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const sequelize = queryInterface.sequelize;
  await sequelize.query(`DROP VIEW IF EXISTS audit_event_feed;`);
  // Los índices creados en up() se dejan intactos deliberadamente al hacer rollback: son útiles
  // por sí mismos para las tablas fuente (independientemente de la vista) y no son destructivos
  // de mantener. Si se requiere un rollback estricto, se pueden borrar manualmente con
  // `DROP INDEX IF EXISTS <nombre>;` para cada uno de los 8 índices listados en up().
}
