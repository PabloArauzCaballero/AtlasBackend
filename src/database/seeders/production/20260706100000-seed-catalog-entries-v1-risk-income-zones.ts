import { QueryInterface, Transaction } from 'sequelize';

/**
 * Fase 4A: Seeders blindados para catálogos maestros versionados.
 *
 * Este seeder crea versiones INMUTABLES de catálogos de negocio crítico.
 * Una vez sembrado y usado en un `risk_assessment_run`, no se puede editar la versión.
 * Si hay cambios, se crea una NUEVA VERSIÓN (risk_bands_v2, etc.).
 *
 * Estructura: catalog_entries con versionamiento explícito.
 * - `catalog_code`: 'risk_bands', 'income_brackets', 'city_zones_scz'
 * - `catalog_version`: 1, 2, 3... (nunca se edita, solo se agrega nueva versión)
 * - `entry_code`: 'risk_band_excellent', 'risk_band_good', etc.
 * - `is_immutable_after_use`: si true y usage_count > 0, no se puede editar
 * - `created_by_platform_user_id`: sistema (NULL) para seeds, o usuario en cambios posteriores
 *
 * AUDITORÍA EXHAUSTIVA: cada inserción va con timestamp, creador, descripción en entrada_attributes.
 */

const CREATED_AT = new Date('2026-01-02T03:00:00.000Z');
const TENANT_ID = 1;

type SeedRow = Record<string, unknown>;
type SeedTable = { tableName: string; rows: SeedRow[] };

async function insertSeedTable(queryInterface: QueryInterface, seedTable: SeedTable, transaction: Transaction): Promise<void> {
  const rows = seedTable.rows.map((row) => ({
    ...row,
    entry_attributes:
      typeof row.entry_attributes === 'object' && row.entry_attributes !== null
        ? JSON.stringify(row.entry_attributes)
        : row.entry_attributes,
  }));

  await queryInterface.bulkInsert(seedTable.tableName, rows, { transaction });
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

const SEED_TABLES: SeedTable[] = [
  {
    tableName: 'catalog_entries',
    rows: [
      // === RISK_BANDS_V1 (IMMUTABLE después de usar) ===
      {
        _id: 1001,
        catalog_code: 'risk_bands',
        catalog_version: 1,
        entry_code: 'risk_band_excellent',
        entry_name: 'Excelente',
        entry_attributes: { score_range: { min: 80, max: 100 }, risk_level: 'low', mdr_pct: 0.0 },
        is_active: true,
        is_immutable_after_use: true,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 1002,
        catalog_code: 'risk_bands',
        catalog_version: 1,
        entry_code: 'risk_band_good',
        entry_name: 'Bueno',
        entry_attributes: { score_range: { min: 60, max: 79 }, risk_level: 'medium', mdr_pct: 0.5 },
        is_active: true,
        is_immutable_after_use: true,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 1003,
        catalog_code: 'risk_bands',
        catalog_version: 1,
        entry_code: 'risk_band_fair',
        entry_name: 'Regular',
        entry_attributes: { score_range: { min: 40, max: 59 }, risk_level: 'medium_high', mdr_pct: 1.0 },
        is_active: true,
        is_immutable_after_use: true,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 1004,
        catalog_code: 'risk_bands',
        catalog_version: 1,
        entry_code: 'risk_band_poor',
        entry_name: 'Bajo',
        entry_attributes: { score_range: { min: 0, max: 39 }, risk_level: 'high', mdr_pct: 2.5 },
        is_active: true,
        is_immutable_after_use: true,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },

      // === INCOME_BRACKETS_V1 (MUTABLE, pero con versionamiento) ===
      {
        _id: 2001,
        catalog_code: 'income_brackets',
        catalog_version: 1,
        entry_code: 'income_0_500',
        entry_name: 'Menos de 500 BOB',
        entry_attributes: { range_min: 0, range_max: 500, risk_band_default: 'poor', income_band: 'very_low' },
        is_active: true,
        is_immutable_after_use: false,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 2002,
        catalog_code: 'income_brackets',
        catalog_version: 1,
        entry_code: 'income_500_1000',
        entry_name: '500 a 1000 BOB',
        entry_attributes: { range_min: 500, range_max: 1000, risk_band_default: 'fair', income_band: 'low' },
        is_active: true,
        is_immutable_after_use: false,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 2003,
        catalog_code: 'income_brackets',
        catalog_version: 1,
        entry_code: 'income_1000_3000',
        entry_name: '1000 a 3000 BOB',
        entry_attributes: { range_min: 1000, range_max: 3000, risk_band_default: 'good', income_band: 'medium' },
        is_active: true,
        is_immutable_after_use: false,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 2004,
        catalog_code: 'income_brackets',
        catalog_version: 1,
        entry_code: 'income_3000_plus',
        entry_name: '3000+ BOB',
        entry_attributes: { range_min: 3000, range_max: 999999, risk_band_default: 'excellent', income_band: 'high' },
        is_active: true,
        is_immutable_after_use: false,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },

      // === CITY_ZONES_SCZ_V1 (MUTABLE) ===
      {
        _id: 3001,
        catalog_code: 'city_zones_scz',
        catalog_version: 1,
        entry_code: 'scz_centro',
        entry_name: 'Centro',
        entry_attributes: { lat_approx: -17.7833, lng_approx: -63.1821, risk_segment: 'urban_core', commerce_density: 'high' },
        is_active: true,
        is_immutable_after_use: false,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 3002,
        catalog_code: 'city_zones_scz',
        catalog_version: 1,
        entry_code: 'scz_sur',
        entry_name: 'Sur',
        entry_attributes: { lat_approx: -17.8333, lng_approx: -63.1821, risk_segment: 'suburban', commerce_density: 'medium' },
        is_active: true,
        is_immutable_after_use: false,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 3003,
        catalog_code: 'city_zones_scz',
        catalog_version: 1,
        entry_code: 'scz_norte',
        entry_name: 'Norte',
        entry_attributes: { lat_approx: -17.75, lng_approx: -63.1821, risk_segment: 'suburban', commerce_density: 'medium' },
        is_active: true,
        is_immutable_after_use: false,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
      {
        _id: 3004,
        catalog_code: 'city_zones_scz',
        catalog_version: 1,
        entry_code: 'scz_este',
        entry_name: 'Este',
        entry_attributes: { lat_approx: -17.7833, lng_approx: -63.15, risk_segment: 'urban_growth', commerce_density: 'low' },
        is_active: true,
        is_immutable_after_use: false,
        usage_count: 0,
        created_by_platform_user_id: null,
        created_at: CREATED_AT,
        superseded_by_version_id: null,
        _created_at: CREATED_AT,
        _updated_at: CREATED_AT,
      },
    ],
  },
];

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
