import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * The "Definiciones" catalog screen (observations/events/attributes/features)
 * had no owner/domain linkage at all, unlike every other catalog screen
 * (tables, glossary, operational catalogs). This adds the columns and backfills
 * domain_code from the existing risk_dimension classification using a
 * deterministic mapping against the real domain codes already seeded in
 * system_domain_catalog — not invented values. Rows backfilled this way are
 * marked review_status = 'NEEDS_REVIEW' (same convention as the rest of the
 * catalog) so a human confirms the mapping instead of treating it as ground
 * truth. owner_team is left NULL where we have no real source of truth for it.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE observation_definitions
  ADD COLUMN IF NOT EXISTS owner_team VARCHAR(80),
  ADD COLUMN IF NOT EXISTS domain_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW';

ALTER TABLE event_definitions
  ADD COLUMN IF NOT EXISTS owner_team VARCHAR(80),
  ADD COLUMN IF NOT EXISTS domain_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW';

ALTER TABLE attribute_definitions
  ADD COLUMN IF NOT EXISTS owner_team VARCHAR(80),
  ADD COLUMN IF NOT EXISTS domain_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW';

ALTER TABLE feature_definitions
  ADD COLUMN IF NOT EXISTS domain_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(40) NOT NULL DEFAULT 'NEEDS_REVIEW';
`);

  const domainCaseSql = `
    CASE risk_dimension
      WHEN 'fraud' THEN 'FRAUDE'
      WHEN 'credit' THEN 'RIESGO_CREDITO'
      WHEN 'external_provider' THEN 'PROVEEDORES'
      WHEN 'contactability' THEN 'COMUNICACIONES'
      WHEN 'consistency' THEN 'CALIDAD_DATOS'
      WHEN 'lifecycle' THEN 'ONBOARDING'
      WHEN 'operations' THEN 'PLATAFORMA'
      WHEN 'demographic' THEN 'IDENTIDAD_KYC'
      WHEN 'identity' THEN 'IDENTIDAD_KYC'
      WHEN 'location' THEN 'DISPOSITIVO'
      ELSE NULL
    END
  `;

  for (const table of ['observation_definitions', 'event_definitions', 'attribute_definitions', 'feature_definitions']) {
    await queryInterface.sequelize.query(`
      UPDATE ${table}
         SET domain_code = ${domainCaseSql},
             review_status = CASE WHEN (${domainCaseSql}) IS NOT NULL THEN 'NEEDS_REVIEW' ELSE review_status END
       WHERE domain_code IS NULL;
    `);
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE observation_definitions
  DROP COLUMN IF EXISTS owner_team,
  DROP COLUMN IF EXISTS domain_code,
  DROP COLUMN IF EXISTS review_status;

ALTER TABLE event_definitions
  DROP COLUMN IF EXISTS owner_team,
  DROP COLUMN IF EXISTS domain_code,
  DROP COLUMN IF EXISTS review_status;

ALTER TABLE attribute_definitions
  DROP COLUMN IF EXISTS owner_team,
  DROP COLUMN IF EXISTS domain_code,
  DROP COLUMN IF EXISTS review_status;

ALTER TABLE feature_definitions
  DROP COLUMN IF EXISTS domain_code,
  DROP COLUMN IF EXISTS review_status;
`);
}
