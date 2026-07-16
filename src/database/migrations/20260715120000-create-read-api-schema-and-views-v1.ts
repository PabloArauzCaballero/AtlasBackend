import { QueryInterface } from 'sequelize';

/**
 * Fase 3 del plan de mejora del modelo de datos: schema `read_api` + primera ola de vistas de lectura
 * versionadas.
 *
 * Objetivo: separar el contrato de LECTURA del modelo de escritura. Cada vista proyecta columnas
 * EXPLÍCITAS (nunca `SELECT *`), produce una fila por caso de uso, permite filtrar/paginar en
 * PostgreSQL y NO expone columnas sensibles (hashes, blobs cifrados, PII completa, secretos).
 *
 * Convención de nombres: `read_api.v_<caso_de_uso>_v1`. Las vistas materializadas (cuando se
 * justifiquen por métricas) irán como `read_api.mv_<agregado>_v1`.
 *
 * ALCANCE / VERIFICACIÓN: esta migración fue escrita y revisada estáticamente — cada columna y tabla
 * fue verificada contra los modelos Sequelize en `src/database/models/`. Igual que
 * `20260703035812-add-unified-audit-event-feed-view.ts`, NO fue ejecutada por quien la escribió
 * contra un Postgres real. Antes de darla por cerrada debe correr una vez vía `yarn db:migration:up`
 * contra el Postgres de CI y confirmarse con los smoke SELECT + EXPLAIN del gate de vistas (Fase 7).
 *
 * El schema se crea SIN `AUTHORIZATION atlas_owner` a propósito: en el setup con roles diferenciados
 * las migraciones corren como `atlas_migrator` con `SET ROLE atlas_owner`, así que los objetos quedan
 * del owner sin hardcodearlo; y en un entorno sin los roles (single-user) la migración no falla. Los
 * grants a `atlas_app_ro`/`atlas_app_rw` se aplican condicionalmente si esos roles existen (y también
 * los aplica `ops/postgres/grants.sql` en el despliegue).
 */

const VIEW_NAMES = [
  'read_api.v_customer_overview_v1',
  'read_api.v_risk_assessment_summary_v1',
  'read_api.v_operations_work_queue_v1',
  'read_api.v_provider_health_latest_v1',
  'read_api.v_notification_delivery_summary_v1',
  'read_api.v_system_endpoint_coverage_v1',
  'read_api.v_audit_event_feed_v1',
] as const;

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const sequelize = queryInterface.sequelize;

  await sequelize.query(`CREATE SCHEMA IF NOT EXISTS read_api;`);
  await sequelize.query(
    `COMMENT ON SCHEMA read_api IS 'Contratos de lectura versionados (Fase 3). Solo vistas curadas; sin PII/secretos.';`,
  );

  // -------------------------------------------------------------------------
  // Índices de soporte (IF NOT EXISTS): alinean las fuentes con los accesos de las vistas.
  // -------------------------------------------------------------------------
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_risk_results_customer_decided ON risk_assessment_results (customer_id, decided_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_risk_results_run ON risk_assessment_results (risk_assessment_run_id, decided_at DESC, _id DESC);`,
  );
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_consents_customer ON customer_consents (customer_id);`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_device_links_customer ON customer_device_links (customer_id);`);
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_manual_review_cases_open ON manual_review_cases (_tenant_id, priority, opened_at DESC, _id DESC) WHERE closed_at IS NULL;`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_fraud_cases_open ON fraud_cases (_tenant_id, opened_at DESC, _id DESC) WHERE closed_at IS NULL;`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_notification_deliveries_message ON notification_deliveries (notification_message_id);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_provider_health_logs_provider_checked ON provider_health_logs (provider_id, checked_at DESC, _id DESC);`,
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_endpoint_data_entity_impacts_endpoint ON system_endpoint_data_entity_impacts (endpoint_id);`,
  );

  // -------------------------------------------------------------------------
  // 1) read_api.v_customer_overview_v1 — resumen por cliente, una fila por cliente.
  //    Sin teléfono/email/documento cifrado; solo dominio de email y últimos 4 del teléfono.
  // -------------------------------------------------------------------------
  await sequelize.query(`
    CREATE VIEW read_api.v_customer_overview_v1 AS
    SELECT
      c._tenant_id AS tenant_id,
      c._id AS customer_id,
      c.customer_code AS customer_code,
      c.customer_uuid AS customer_uuid,
      c.lifecycle_status AS lifecycle_status,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ', pv.first_name, pv.last_name)), ''), pv.full_name_normalized) AS display_name,
      pv.birth_date AS birth_date,
      pv.preferred_language AS preferred_language,
      c.primary_email_domain AS primary_email_domain,
      c.primary_phone_last_4 AS primary_phone_last_4,
      risk.risk_assessment_run_id AS latest_risk_assessment_run_id,
      risk.recommended_action AS latest_risk_decision,
      risk.risk_level AS latest_risk_band,
      risk.score_total AS latest_risk_score,
      risk.decided_at AS latest_risk_decided_at,
      (SELECT count(*) FROM customer_consents cc
        WHERE cc.customer_id = c._id AND cc._tenant_id = c._tenant_id
          AND cc.granted = true AND cc.revoked_at IS NULL) AS active_consent_count,
      (SELECT count(*) FROM customer_device_links dl
        WHERE dl.customer_id = c._id AND dl._tenant_id = c._tenant_id
          AND dl.link_status = 'active' AND COALESCE(dl._deleted, false) = false) AS active_device_count,
      (SELECT count(*) FROM manual_review_cases mr
        WHERE mr.customer_id = c._id AND mr._tenant_id = c._tenant_id
          AND mr.closed_at IS NULL AND COALESCE(mr._deleted, false) = false) AS open_manual_review_count,
      (SELECT count(*) FROM fraud_cases fc
        WHERE fc.customer_id = c._id AND fc._tenant_id = c._tenant_id
          AND fc.closed_at IS NULL AND COALESCE(fc._deleted, false) = false) AS open_fraud_case_count,
      COALESCE(c._updated_at, c._created_at) AS last_activity_at
    FROM customers c
    LEFT JOIN customer_profile_versions pv ON pv._id = c.current_profile_version_id
    LEFT JOIN LATERAL (
      SELECT r.risk_assessment_run_id, r.recommended_action, r.risk_level, r.score_total, r.decided_at
      FROM risk_assessment_results r
      WHERE r.customer_id = c._id AND r._tenant_id = c._tenant_id
      ORDER BY r.decided_at DESC NULLS LAST, r._id DESC
      LIMIT 1
    ) risk ON true
    WHERE COALESCE(c._deleted, false) = false;
  `);
  await sequelize.query(
    `COMMENT ON VIEW read_api.v_customer_overview_v1 IS 'Resumen por cliente (una fila): estado, última decisión de riesgo y conteos activos. Sin PII cifrada.';`,
  );

  // -------------------------------------------------------------------------
  // 2) read_api.v_risk_assessment_summary_v1 — una fila por corrida, con su resultado más reciente.
  // -------------------------------------------------------------------------
  await sequelize.query(`
    CREATE VIEW read_api.v_risk_assessment_summary_v1 AS
    SELECT
      run._tenant_id AS tenant_id,
      run._id AS risk_assessment_run_id,
      run.customer_id AS customer_id,
      run.run_status AS status,
      run.assessment_type AS assessment_type,
      run.started_at AS requested_at,
      run.completed_at AS completed_at,
      res.decided_at AS decided_at,
      res.model_version_code_snapshot AS model_version_code,
      res.ruleset_version_code_snapshot AS ruleset_version_code,
      res.score_total AS score,
      res.risk_level AS risk_band,
      res.recommended_action AS decision,
      res.reason_codes_json AS reason_codes_json,
      (res.recommended_action = 'MANUAL_REVIEW') AS manual_review_required,
      (res.recommended_action = 'BLOCK') AS hard_stop_triggered
    FROM risk_assessment_runs run
    LEFT JOIN LATERAL (
      SELECT rr.decided_at, rr.model_version_code_snapshot, rr.ruleset_version_code_snapshot,
             rr.score_total, rr.risk_level, rr.recommended_action, rr.reason_codes_json
      FROM risk_assessment_results rr
      WHERE rr.risk_assessment_run_id = run._id
      ORDER BY rr.decided_at DESC NULLS LAST, rr._id DESC
      LIMIT 1
    ) res ON true;
  `);
  await sequelize.query(
    `COMMENT ON VIEW read_api.v_risk_assessment_summary_v1 IS 'Decisión de riesgo por corrida sin contextos ni todas las features; incluye el resultado más reciente.';`,
  );

  // -------------------------------------------------------------------------
  // 3) read_api.v_operations_work_queue_v1 — cola operativa unificada (solo ítems abiertos).
  //    "Abierto" se expresa por ausencia de cierre (closed_at/resolved_at IS NULL), robusto ante
  //    los distintos vocabularios de estado de cada tabla.
  // -------------------------------------------------------------------------
  await sequelize.query(`
    CREATE VIEW read_api.v_operations_work_queue_v1 AS
    SELECT
      mr._tenant_id AS tenant_id,
      'manual_review'::text AS queue_item_type,
      mr._id::text AS queue_item_id,
      mr.customer_id AS customer_id,
      mr.status::text AS status,
      mr.priority::text AS priority,
      NULL::text AS severity,
      mr.case_type::text AS reason_code,
      mr.assigned_to_internal_user_id AS assigned_to,
      COALESCE(mr.opened_at, mr._created_at) AS created_at,
      NULL::timestamptz AS due_at,
      mr._updated_at AS updated_at
    FROM manual_review_cases mr
    WHERE mr.closed_at IS NULL AND COALESCE(mr._deleted, false) = false

    UNION ALL

    SELECT
      fc._tenant_id,
      'fraud_case'::text,
      fc._id::text,
      fc.customer_id,
      fc.case_status::text,
      NULL::text,
      fc.severity::text,
      fc.pattern_detected::text,
      fc.assigned_to_internal_user_id,
      COALESCE(fc.opened_at, fc._created_at),
      NULL::timestamptz,
      fc._updated_at
    FROM fraud_cases fc
    WHERE fc.closed_at IS NULL AND COALESCE(fc._deleted, false) = false

    UNION ALL

    SELECT
      dqi._tenant_id,
      'data_quality_issue'::text,
      dqi._id::text,
      NULL::bigint,
      dqi.issue_status::text,
      NULL::text,
      dqr.severity::text,
      dqi.target_table::text,
      NULL::bigint,
      COALESCE(dqi.detected_at, dqi._created_at),
      NULL::timestamptz,
      NULL::timestamptz
    FROM data_quality_issues dqi
    LEFT JOIN data_quality_rules dqr ON dqr._id = dqi.quality_rule_id
    WHERE dqi.resolved_at IS NULL

    UNION ALL

    SELECT
      dsr._tenant_id,
      'data_subject_request'::text,
      dsr._id::text,
      dsr.customer_id,
      dsr.status::text,
      NULL::text,
      NULL::text,
      dsr.request_type::text,
      dsr.handled_by,
      COALESCE(dsr.requested_at, dsr._created_at),
      dsr.due_at,
      dsr._updated_at
    FROM data_subject_requests dsr
    WHERE dsr.resolved_at IS NULL AND COALESCE(dsr._deleted, false) = false;
  `);
  await sequelize.query(
    `COMMENT ON VIEW read_api.v_operations_work_queue_v1 IS 'Cola operativa unificada (revisión manual, fraude, calidad de datos, solicitudes de privacidad) con ítems abiertos. Paginar por (priority, created_at, queue_item_type, queue_item_id).';`,
  );

  // -------------------------------------------------------------------------
  // 4) read_api.v_provider_health_latest_v1 — último health por proveedor (platform-shared, sin tenant).
  // -------------------------------------------------------------------------
  await sequelize.query(`
    CREATE VIEW read_api.v_provider_health_latest_v1 AS
    SELECT DISTINCT ON (phl.provider_id)
      phl.provider_id AS provider_id,
      dp.provider_code AS provider_code,
      dp.provider_name AS provider_name,
      dp.provider_status AS provider_status,
      phl.status AS health_status,
      phl.mode_checked AS mode_checked,
      phl.latency_ms AS latency_ms,
      phl.checked_at AS checked_at,
      phl.error_code AS error_code
    FROM provider_health_logs phl
    JOIN data_providers dp ON dp._id = phl.provider_id
    ORDER BY phl.provider_id, phl.checked_at DESC, phl._id DESC;
  `);
  await sequelize.query(
    `COMMENT ON VIEW read_api.v_provider_health_latest_v1 IS 'Estado actual de cada proveedor externo (última medición), sin recorrer el histórico completo.';`,
  );

  // -------------------------------------------------------------------------
  // 5) read_api.v_notification_delivery_summary_v1 — resumen por mensaje con agregados de intentos.
  //    delivered/failed se cuentan por presencia de timestamp (robusto ante el vocabulario de status).
  // -------------------------------------------------------------------------
  await sequelize.query(`
    CREATE VIEW read_api.v_notification_delivery_summary_v1 AS
    SELECT
      m._tenant_id AS tenant_id,
      m._id AS message_id,
      m.template_code AS template_code,
      m.channel AS channel,
      m.recipient_type AS recipient_type,
      m.category AS category,
      m.status AS status,
      m.priority AS priority,
      m._created_at AS created_at,
      m.scheduled_at AS scheduled_at,
      m.sent_at AS sent_at,
      m.delivered_at AS delivered_at,
      m.failed_at AS failed_at,
      COALESCE(d.attempt_count, 0) AS attempt_count,
      COALESCE(d.delivered_count, 0) AS delivered_count,
      COALESCE(d.failed_count, 0) AS failed_count,
      d.last_attempt_at AS last_attempt_at,
      d.last_error_code AS last_error_code
    FROM notification_messages m
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS attempt_count,
        count(*) FILTER (WHERE nd.delivered_at IS NOT NULL) AS delivered_count,
        count(*) FILTER (WHERE nd.failed_at IS NOT NULL) AS failed_count,
        max(nd._created_at) AS last_attempt_at,
        (ARRAY_AGG(nd.error_code ORDER BY nd._id DESC) FILTER (WHERE nd.error_code IS NOT NULL))[1] AS last_error_code
      FROM notification_deliveries nd
      WHERE nd.notification_message_id = m._id
    ) d ON true;
  `);
  await sequelize.query(
    `COMMENT ON VIEW read_api.v_notification_delivery_summary_v1 IS 'Estado resumido por mensaje de notificación con conteos de intentos/entregas/fallos; el detalle vive en un endpoint paginado.';`,
  );

  // -------------------------------------------------------------------------
  // 6) read_api.v_system_endpoint_coverage_v1 — cobertura técnica por endpoint.
  //    test_suite_count es por MÓDULO (las suites se asocian a módulo, no a endpoint) — nombrado así.
  // -------------------------------------------------------------------------
  await sequelize.query(`
    CREATE VIEW read_api.v_system_endpoint_coverage_v1 AS
    SELECT
      e._id AS endpoint_id,
      e.method AS method,
      e.full_path AS full_path,
      e.module AS module,
      e.risk_level AS risk_level,
      e.review_status AS review_status,
      e.requires_auth AS requires_auth,
      e.contains_pii AS contains_pii,
      e.is_readonly AS is_readonly,
      e.is_destructive AS is_destructive,
      CASE WHEN jsonb_typeof(e.pii_fields) = 'array' THEN jsonb_array_length(e.pii_fields) ELSE 0 END AS sensitive_field_count,
      (SELECT count(*) FROM system_endpoint_data_entity_impacts i WHERE i.endpoint_id = e._id) AS data_entity_count,
      (SELECT count(*) FROM system_test_suites s WHERE s.module = e.module) AS module_test_suite_count,
      (lower(e.review_status) = 'approved') AS release_ready
    FROM system_endpoint_catalog e;
  `);
  await sequelize.query(
    `COMMENT ON VIEW read_api.v_system_endpoint_coverage_v1 IS 'Cobertura por endpoint: riesgo, revisión, entidades impactadas, campos sensibles y suites del módulo.';`,
  );

  // -------------------------------------------------------------------------
  // 7) read_api.v_audit_event_feed_v1 — versión curada de la vista de auditoría existente.
  // -------------------------------------------------------------------------
  await sequelize.query(`
    CREATE VIEW read_api.v_audit_event_feed_v1 AS
    SELECT
      source_table,
      source_id,
      tenant_id,
      occurred_at,
      actor_type,
      event_type,
      target_type,
      target_id,
      payload_json
    FROM audit_event_feed;
  `);
  await sequelize.query(
    `COMMENT ON VIEW read_api.v_audit_event_feed_v1 IS 'Feed de auditoría unificado con cursor (occurred_at, source_table, source_id). Envuelve la vista audit_event_feed.';`,
  );

  // -------------------------------------------------------------------------
  // Grants condicionales: solo si los roles existen (también los aplica ops/postgres/grants.sql).
  // -------------------------------------------------------------------------
  await sequelize.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_ro') THEN
        GRANT USAGE ON SCHEMA read_api TO atlas_app_ro;
        GRANT SELECT ON ALL TABLES IN SCHEMA read_api TO atlas_app_ro;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_rw') THEN
        GRANT USAGE ON SCHEMA read_api TO atlas_app_rw;
        GRANT SELECT ON ALL TABLES IN SCHEMA read_api TO atlas_app_rw;
      END IF;
    END$$;
  `);
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const sequelize = queryInterface.sequelize;
  for (const view of [...VIEW_NAMES].reverse()) {
    await sequelize.query(`DROP VIEW IF EXISTS ${view};`);
  }
  // Se elimina el schema solo si quedó vacío (RESTRICT); si otra migración añadió objetos a read_api,
  // este down no los toca. Los índices de soporte se dejan intactos (son útiles por sí mismos), igual
  // que en 20260703035812-add-unified-audit-event-feed-view.ts.
  await sequelize.query(`DROP SCHEMA IF EXISTS read_api RESTRICT;`);
}
