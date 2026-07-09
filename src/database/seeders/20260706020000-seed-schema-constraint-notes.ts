import { QueryInterface, Transaction } from 'sequelize';

/**
 * PENDIENTE_ATLAS (continuación de Fase 2): cierra `schema_constraint_notes`, la última tabla de
 * catálogo/documentación que quedaba en 0 filas y que SÍ tiene sentido sembrar (a diferencia de
 * `system_test_runs`, `auth_refresh_tokens`, etc., que son artefactos de runtime).
 *
 * Este catálogo documenta, en lenguaje de negocio, los 5 CHECK CONSTRAINTS reales que existen hoy
 * en el schema (verificados leyendo `CHECK_CONSTRAINTS` en las 10 migraciones
 * `schema-relationships-part-*`). No se inventa ningún constraint nuevo aquí — solo se documenta
 * lo que ya existe en la base de datos, para que el panel de operaciones / data-quality pueda
 * mostrarlo sin tener que leer el código de las migraciones.
 */

const CREATED_AT = new Date('2026-01-02T02:00:00.000Z');

type SeedRow = Record<string, unknown>;
type SeedTable = { tableName: string; rows: SeedRow[] };

const SEED_TABLES: SeedTable[] = [
  {
    tableName: 'schema_constraint_notes',
    rows: [
      {
        _id: 1,
        table_name: 'data_provider_responses',
        constraint_type: 'check',
        constraint_expression: 'ck_data_provider_response_payload_strategy',
        rationale:
          'La estrategia de almacenamiento del payload (inline_full, inline_redacted, s3_raw, hashed_only) debe ' +
          'coincidir con qué columna realmente tiene datos, para evitar guardar payloads de proveedores externos ' +
          'de forma inconsistente con la política de retención/clasificación declarada.',
        build_phase: 'MVP',
        is_required_for_mvp: true,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 2,
        table_name: 'evidence_documents',
        constraint_type: 'check',
        constraint_expression: 'ck_evidence_document_not_orphan',
        rationale:
          'Toda evidencia (documento/selfie/foto) debe quedar asociada a un cliente o, como mínimo, a la sesión ' +
          'desde la que se subió. Evita evidencia huérfana que no se pueda auditar ni vincular a un titular de datos.',
        build_phase: 'MVP',
        is_required_for_mvp: true,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 3,
        table_name: 'on_device_computation_runs',
        constraint_type: 'check',
        constraint_expression: 'ck_on_device_no_raw_contacts_or_sms',
        rationale:
          'Refuerza a nivel de base de datos la regla de privacidad de MOBILE_DEVELOPMENT_CONTEXT.md: nunca se ' +
          'sube agenda de contactos ni SMS crudos al backend. `raw_contacts_stored` y `raw_sms_stored` deben ser ' +
          'siempre false; solo se permite guardar puntajes/indicadores agregados calculados en el dispositivo.',
        build_phase: 'MVP',
        is_required_for_mvp: true,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 4,
        table_name: 'risk_assessment_runs',
        constraint_type: 'check',
        constraint_expression: 'ck_risk_assessment_subject_present',
        rationale:
          'Todo assessment de riesgo debe estar atado a al menos un sujeto real (cliente, sesión, flujo de ' +
          'onboarding o dispositivo). Evita ejecuciones de scoring "flotantes" sin trazabilidad hacia qué o quién ' +
          'se está evaluando.',
        build_phase: 'MVP',
        is_required_for_mvp: true,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 5,
        table_name: 'watchlist_entries',
        constraint_type: 'check',
        constraint_expression: 'ck_watchlist_entries_scope_consistency',
        rationale:
          'El alcance de una entrada de watchlist (global, país o tenant) debe ser consistente con sus columnas: ' +
          'global no lleva tenant ni país, country no lleva tenant, tenant sí requiere tenant. Evita listas negras ' +
          'mal alcanzadas que bloqueen o aprueben clientes de otro tenant/país por error.',
        build_phase: 'MVP',
        is_required_for_mvp: true,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
];

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
    for (const seedTable of SEED_TABLES) {
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
    }
  });
}
