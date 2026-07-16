import { QueryInterface, Transaction } from 'sequelize';

/**
 * PENDIENTE_ATLAS / ATLAS-TECH-PEND (continuación de 20260706000000-seed-deep-graph-demo-data.ts):
 * cierra 6 tablas más del listado de 45 tablas sin fila detectadas en la auditoría de seeds.
 *
 * `data_providers._id` NO es fijo (el seeder `20260702032000-seed-external-data-providers.ts` lo
 * inserta por SQL crudo con `ON CONFLICT (provider_code)`, sin fijar `_id`), así que
 * `data_provider_requests.provider_id` se resuelve aquí con un `INSERT ... SELECT` por
 * `provider_code` en vez de un `_id` literal, para no asumir un valor de secuencia que puede
 * cambiar según el orden real de ejecución.
 *
 * SUPUESTO_ATLAS: payloads de proveedor son mocks ilustrativos (no hay contrato real de
 * SEGIP/InfoCenter documentado todavía, ver PENDIENTES_ATLAS.md). Sirven para ejercitar el flujo
 * de auditoría/retención de `data_provider_responses`, no para validar reglas de negocio reales.
 *
 * Quedan pendientes a propósito (no se siembran aquí): content_subscribers,
 * external_oauth_connections, auth_refresh_tokens, system_action_logs, system_test_runs,
 * system_test_step_runs. Motivo igual que en el seeder anterior: son artefactos de runtime o de
 * ejecución real de test/OAuth, no datos de referencia sembrables sin falsear su propósito.
 */

const CREATED_AT = new Date('2026-01-02T01:00:00.000Z');
const TENANT_ID = 1;
const CUSTOMER_ID = 1;
const CONSENT_ID = 1;
const RISK_RUN_ID = 1;
const ADMIN_PLATFORM_USER_ID = 1;

const jsonb = (value: unknown): string => JSON.stringify(value);

type SeedRow = Record<string, unknown>;
type SeedTable = { tableName: string; rows: SeedRow[] };

type QueryParams = { sql: string; replacements?: Record<string, unknown>; transaction: Transaction };

async function runQuery(queryInterface: QueryInterface, input: QueryParams): Promise<void> {
  await queryInterface.sequelize.query(input.sql, { replacements: input.replacements, transaction: input.transaction });
}

// --- Tablas simples sin FK a data_providers: van por bulkInsert normal ---
const SEED_TABLES: SeedTable[] = [
  {
    tableName: 'idempotency_keys',
    rows: [
      {
        _id: 1,
        tenant_scope: `tenant:${TENANT_ID}`,
        actor_type: 'customer',
        actor_id: String(CUSTOMER_ID),
        idempotency_key: 'seed-onboarding-submit-001',
        scope: 'POST:/api/v1/customer-onboarding',
        request_hash: 'dev_seed_hash_idempotency_request_0001',
        status: 'completed',
        response_status: 201,
        response_body_json: jsonb({ customerId: CUSTOMER_ID, status: 'created' }),
        locked_until: null,
        completed_at: CREATED_AT,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'context_ingestion_jobs',
    rows: [
      {
        _id: 1,
        job_code: 'ingest-scz-zones-2026-01',
        source_type: 'manual_upload',
        source_name: 'Propuesta zonas SCZ - equipo de riesgo',
        triggered_by_type: 'platform_user',
        triggered_by_platform_user_id: ADMIN_PLATFORM_USER_ID,
        status: 'completed',
        started_at: CREATED_AT,
        finished_at: CREATED_AT,
        summary_json: jsonb({ proposedItems: 1, autoApproved: 0 }),
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'context_staging_items',
    rows: [
      {
        _id: 1,
        catalog_id: 101, // city_zones_scz
        ingestion_job_id: 1,
        proposed_item_code: 'scz_este_pampa',
        proposed_item_name: 'Este / Pampa de la Isla',
        proposed_attributes_json: jsonb({ riskSegment: 'urban_growth', displayOrder: 6 }),
        ai_suggested: false,
        review_status: 'approved',
        review_notes: 'Zona nueva confirmada por equipo de riesgo para cobertura de comercios.',
        created_by_type: 'platform_user',
        created_by_platform_user_id: ADMIN_PLATFORM_USER_ID,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'context_approval_events',
    rows: [
      {
        _id: 1,
        staging_item_id: 1,
        catalog_version_id: 101,
        event_type: 'approved',
        decided_by_platform_user_id: ADMIN_PLATFORM_USER_ID,
        decided_at: CREATED_AT,
        decision_reason: 'Zona validada contra fuente municipal de referencia (seed de desarrollo).',
        _created_at: CREATED_AT,
      },
    ],
  },
  {
    tableName: 'data_provider_responses',
    rows: [
      {
        _id: 1,
        _tenant_id: TENANT_ID,
        provider_request_id: 1,
        payload_storage_strategy: 'inline_redacted',
        response_payload_json: jsonb({ match: true, confidence: 0.97 }),
        redacted_payload_json: jsonb({ match: true }),
        raw_payload_s3_key: null,
        response_hash: 'dev_seed_hash_provider_response_segip_0001',
        normalized_payload_json: jsonb({ identityMatch: true }),
        contains_sensitive_data: true,
        retention_policy_id: 104,
        retention_until: '2027-01-02',
        _created_at: CREATED_AT,
      },
      {
        _id: 2,
        _tenant_id: TENANT_ID,
        provider_request_id: 2,
        payload_storage_strategy: 'inline_redacted',
        response_payload_json: jsonb({ dpdMax12m: 0, hasNegativeHit: false }),
        redacted_payload_json: jsonb({ hasNegativeHit: false }),
        raw_payload_s3_key: null,
        response_hash: 'dev_seed_hash_provider_response_infocenter_0001',
        normalized_payload_json: jsonb({ bureauClean: true }),
        contains_sensitive_data: true,
        retention_policy_id: 104,
        retention_until: '2027-01-02',
        _created_at: CREATED_AT,
      },
    ],
  },
];

// --- data_provider_requests: requiere resolver provider_id por provider_code (no es un _id fijo) ---
const PROVIDER_REQUESTS: Array<{
  id: number;
  providerCode: string;
  requestType: string;
  requestRef: string;
  status: string;
  code: string;
  latencyMs: number;
}> = [
  {
    id: 1,
    providerCode: 'SEGIP',
    requestType: 'identity_verification',
    requestRef: 'seed-segip-req-0001',
    status: 'success',
    code: 'OK',
    latencyMs: 420,
  },
  {
    id: 2,
    providerCode: 'INFOCENTER',
    requestType: 'credit_bureau_query',
    requestRef: 'seed-infocenter-req-0001',
    status: 'success',
    code: 'OK',
    latencyMs: 610,
  },
];

async function insertProviderRequests(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const request of PROVIDER_REQUESTS) {
    await runQuery(queryInterface, {
      transaction,
      sql: `
        INSERT INTO data_provider_requests (
          _id, _tenant_id, provider_id, customer_id, risk_assessment_run_id, consent_id,
          request_type, provider_request_ref, request_payload_hash, idempotency_key,
          response_status, response_code, latency_ms, requested_at, responded_at, _created_at
        )
        SELECT
          :id, :tenantId, dp._id, :customerId, :riskRunId, :consentId,
          :requestType, :requestRef, :requestHash, :requestRef,
          :responseStatus, :responseCode, :latencyMs, :requestedAt, :respondedAt, :createdAt
        FROM data_providers dp
        WHERE dp.provider_code = :providerCode
        ON CONFLICT (_id) DO NOTHING;
      `,
      replacements: {
        id: request.id,
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        riskRunId: RISK_RUN_ID,
        consentId: CONSENT_ID,
        requestType: request.requestType,
        requestRef: request.requestRef,
        requestHash: `dev_seed_hash_provider_request_${request.providerCode.toLowerCase()}_0001`,
        responseStatus: request.status,
        responseCode: request.code,
        latencyMs: request.latencyMs,
        requestedAt: CREATED_AT,
        respondedAt: CREATED_AT,
        createdAt: CREATED_AT,
        providerCode: request.providerCode,
      },
    });
  }
}

async function deleteProviderRequests(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `DELETE FROM data_provider_requests WHERE _id = ANY(:ids);`,
    replacements: { ids: PROVIDER_REQUESTS.map((r) => r.id) },
  });
}

async function insertSeedTable(queryInterface: QueryInterface, seedTable: SeedTable, transaction: Transaction): Promise<void> {
  await queryInterface.bulkInsert(seedTable.tableName, seedTable.rows, { transaction });
}

async function deleteSeedTable(queryInterface: QueryInterface, seedTable: SeedTable, transaction: Transaction): Promise<void> {
  const identityValues = seedTable.rows
    .map((row) => row._id)
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');

  if (identityValues.length === 0) return;

  await queryInterface.bulkDelete(seedTable.tableName, { _id: identityValues }, { transaction });
}

async function resetSequence(queryInterface: QueryInterface, tableName: string, transaction: Transaction): Promise<void> {
  await queryInterface.sequelize.query(
    `
    SELECT setval(
      pg_get_serial_sequence('${tableName}', '_id'),
      COALESCE((SELECT MAX("_id") FROM "${tableName}"), 1),
      true
    )
    WHERE pg_get_serial_sequence('${tableName}', '_id') IS NOT NULL;
  `,
    { transaction },
  );
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Orden importa: ingestion_job antes de staging_items, staging_items antes de approval_events,
    // provider_requests antes de provider_responses (FK real).
    for (const seedTable of SEED_TABLES) {
      if (seedTable.tableName === 'data_provider_responses') {
        await insertProviderRequests(queryInterface, transaction);
        await resetSequence(queryInterface, 'data_provider_requests', transaction);
      }
      await insertSeedTable(queryInterface, seedTable, transaction);
      await resetSequence(queryInterface, seedTable.tableName, transaction);
    }
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const seedTable of [...SEED_TABLES].reverse()) {
      await deleteSeedTable(queryInterface, seedTable, transaction);
      await resetSequence(queryInterface, seedTable.tableName, transaction);
      if (seedTable.tableName === 'data_provider_responses') {
        await deleteProviderRequests(queryInterface, transaction);
        await resetSequence(queryInterface, 'data_provider_requests', transaction);
      }
    }
  });
}
