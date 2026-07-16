import { QueryInterface, Transaction } from 'sequelize';

/**
 * Versión de modelo y ruleset base de riesgo (perfil PRODUCTION).
 *
 * Antes, la única fila `risk_ruleset_versions` / `risk_model_versions` con `_id = 101`
 * (`atlas_mvp_onboarding_ruleset` / `atlas_bnpl_application_score`) la creaba el seeder demo
 * `demo/20260705090000-seed-portal-runtime-demo-data.ts`. Pero el baseline BNPL productivo
 * (`production/20260711090000-seed-bnpl-production-risk-baseline.ts`) DEPENDE de que ese ruleset
 * exista (`getRulesetId` lanza si falta). Eso hacía que `db:seed:prod` fallara sin datos demo.
 *
 * Este seeder mueve la creación del ruleset/modelo al perfil productivo y la vuelve idempotente
 * (`ON CONFLICT (_id) DO UPDATE`). El seeder demo ya no crea estas filas; solo referencia el
 * `_id = 101` que este seeder garantiza. `approved_by_platform_user_id` queda en NULL: en
 * producción no existe un usuario de plataforma "sembrador" (la columna es nullable).
 *
 * Corre antes que el baseline BNPL (`085000 < 090000`) y, por ser de perfil production, antes de
 * cualquier seeder demo en los perfiles `development`/`demo`.
 */

const CREATED_AT = new Date('2026-07-11T00:00:00.000Z');
const RISK_MODEL_VERSION_ID = 101;
const RISK_RULESET_VERSION_ID = 101;

type QueryParams = {
  sql: string;
  replacements?: Record<string, unknown>;
  transaction: Transaction;
};

async function runQuery(queryInterface: QueryInterface, input: QueryParams): Promise<void> {
  await queryInterface.sequelize.query(input.sql, { replacements: input.replacements, transaction: input.transaction });
}

async function resetSequence(queryInterface: QueryInterface, tableName: string, transaction: Transaction): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      SELECT setval(
        pg_get_serial_sequence(:tableName, '_id'),
        GREATEST(COALESCE((SELECT MAX(_id) FROM ${tableName}), 1), 1),
        true
      )
      WHERE pg_get_serial_sequence(:tableName, '_id') IS NOT NULL;
    `,
    replacements: { tableName },
  });
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await runQuery(queryInterface, {
      transaction,
      sql: `
        INSERT INTO risk_model_versions (
          _id, model_code, version_code, model_type, assessment_type, status,
          effective_from, effective_until, approved_by_platform_user_id, approved_at,
          artifact_url, artifact_hash, _created_at
        )
        VALUES (
          :id, 'atlas_bnpl_application_score', 'v1-seed', 'scorecard_placeholder', 'onboarding_credit', 'active',
          :createdAt, NULL, NULL, NULL,
          'seed://risk/atlas_bnpl_application_score/v1', 'seed-artifact-hash-v1', :createdAt
        )
        ON CONFLICT (_id) DO UPDATE SET
          model_code = EXCLUDED.model_code,
          version_code = EXCLUDED.version_code,
          model_type = EXCLUDED.model_type,
          assessment_type = EXCLUDED.assessment_type,
          status = EXCLUDED.status,
          effective_from = EXCLUDED.effective_from,
          artifact_url = EXCLUDED.artifact_url,
          artifact_hash = EXCLUDED.artifact_hash;
      `,
      replacements: { id: RISK_MODEL_VERSION_ID, createdAt: CREATED_AT },
    });

    await runQuery(queryInterface, {
      transaction,
      sql: `
        INSERT INTO risk_ruleset_versions (
          _id, ruleset_code, version_code, assessment_type, status,
          effective_from, effective_until, approved_by_platform_user_id, approved_at, _created_at
        )
        VALUES (
          :id, 'atlas_mvp_onboarding_ruleset', 'v1-seed', 'onboarding_credit', 'active',
          :createdAt, NULL, NULL, NULL, :createdAt
        )
        ON CONFLICT (_id) DO UPDATE SET
          ruleset_code = EXCLUDED.ruleset_code,
          version_code = EXCLUDED.version_code,
          assessment_type = EXCLUDED.assessment_type,
          status = EXCLUDED.status,
          effective_from = EXCLUDED.effective_from;
      `,
      replacements: { id: RISK_RULESET_VERSION_ID, createdAt: CREATED_AT },
    });

    await resetSequence(queryInterface, 'risk_model_versions', transaction);
    await resetSequence(queryInterface, 'risk_ruleset_versions', transaction);
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Solo borra si nada más lo referencia (las reglas BNPL y las corridas demo cuelgan de estos ids).
    await runQuery(queryInterface, {
      transaction,
      sql: `DELETE FROM risk_ruleset_versions WHERE _id = :id
              AND NOT EXISTS (SELECT 1 FROM risk_policy_rules WHERE ruleset_version_id = :id);`,
      replacements: { id: RISK_RULESET_VERSION_ID },
    });
    await runQuery(queryInterface, {
      transaction,
      sql: `DELETE FROM risk_model_versions WHERE _id = :id;`,
      replacements: { id: RISK_MODEL_VERSION_ID },
    });
  });
}
