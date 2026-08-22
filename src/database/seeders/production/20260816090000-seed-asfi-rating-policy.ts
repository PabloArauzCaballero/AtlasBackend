/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define production para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface, Transaction } from 'sequelize';

/**
 * Matriz de calificación de cartera A–F, escala ASFI (perfil PRODUCTION).
 *
 * Es política de PLATAFORMA (`_tenant_id IS NULL`): la escala regulatoria es la misma para todo
 * tenant que no haya aprobado una propia, y sembrar una copia por tenant sólo multiplicaría los
 * sitios donde corregir un umbral. Un tenant con matriz propia inserta su versión con su
 * `_tenant_id` y el motor la prefiere automáticamente.
 *
 * Sin esta fila el motor NO califica: `resolveActivePolicy` lanza `RATING_POLICY_NOT_ACTIVE` en vez
 * de caer a una escala por defecto escrita en código. Esa es la decisión de diseño del módulo —una
 * previsión calculada con umbrales que nadie aprobó es indistinguible en la base de una legítima— y
 * por eso el seeder vive en el perfil productivo y no entre los datos de demostración.
 *
 * Los umbrales y porcentajes de abajo son el punto de partida operativo, no una transcripción
 * literal de la norma para cada tipo de crédito. Cambiarlos es insertar una versión nueva y activarla:
 * las calificaciones ya emitidas conservan su `policy_version_id` y siguen siendo reproducibles.
 */

const CREATED_AT = new Date('2026-08-16T00:00:00.000Z');
const POLICY_VERSION_ID = 1;
const POLICY_CODE = 'asfi_portfolio_rating';
const VERSION_CODE = 'v1';

/**
 * Bandas de la escala. `severity_rank` 0 es la mejor categoría y decide el arrastre al calificar al
 * cliente; `max_days_past_due = null` marca la banda abierta, que debe ser la última.
 */
const BANDS = [
  { id: 1, grade: 'A', label: 'Normal', rank: 0, min: 0, max: 0, provision: '0.0100' },
  { id: 2, grade: 'B', label: 'Riesgo potencial', rank: 1, min: 1, max: 30, provision: '0.0500' },
  { id: 3, grade: 'C', label: 'Deficiente', rank: 2, min: 31, max: 60, provision: '0.2000' },
  { id: 4, grade: 'D', label: 'Dudoso', rank: 3, min: 61, max: 90, provision: '0.5000' },
  { id: 5, grade: 'E', label: 'Pérdida', rank: 4, min: 91, max: 180, provision: '0.8000' },
  { id: 6, grade: 'F', label: 'Pérdida irrecuperable', rank: 5, min: 181, max: null, provision: '1.0000' },
] as const;

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
        INSERT INTO rating_policy_versions (
          _id, _tenant_id, policy_code, version_code, scale_code, status,
          effective_from, contamination_enabled, description, _created_at
        ) VALUES (
          :id, NULL, :policyCode, :versionCode, 'asfi_a_f', 'active',
          :createdAt, true, :description, :createdAt
        )
        ON CONFLICT (_id) DO UPDATE SET
          policy_code = EXCLUDED.policy_code,
          version_code = EXCLUDED.version_code,
          scale_code = EXCLUDED.scale_code,
          status = EXCLUDED.status,
          contamination_enabled = EXCLUDED.contamination_enabled,
          description = EXCLUDED.description,
          _updated_at = EXCLUDED._created_at;
      `,
      replacements: {
        id: POLICY_VERSION_ID,
        policyCode: POLICY_CODE,
        versionCode: VERSION_CODE,
        createdAt: CREATED_AT,
        description:
          'Escala A–F de calificación de cartera con previsión por categoría. El cliente hereda la peor categoría ' +
          'de sus operaciones (arrastre). Punto de partida operativo: una matriz por tipo de crédito se carga como ' +
          'una versión nueva sin tocar código.',
      },
    });

    for (const band of BANDS) {
      await runQuery(queryInterface, {
        transaction,
        sql: `
          INSERT INTO rating_policy_bands (
            _id, policy_version_id, grade, grade_label, severity_rank,
            min_days_past_due, max_days_past_due, provision_rate, _created_at
          ) VALUES (
            :id, :policyVersionId, :grade, :label, :rank, :min, :max, :provision, :createdAt
          )
          ON CONFLICT (_id) DO UPDATE SET
            grade = EXCLUDED.grade,
            grade_label = EXCLUDED.grade_label,
            severity_rank = EXCLUDED.severity_rank,
            min_days_past_due = EXCLUDED.min_days_past_due,
            max_days_past_due = EXCLUDED.max_days_past_due,
            provision_rate = EXCLUDED.provision_rate;
        `,
        replacements: {
          id: band.id,
          policyVersionId: POLICY_VERSION_ID,
          grade: band.grade,
          label: band.label,
          rank: band.rank,
          min: band.min,
          max: band.max,
          provision: band.provision,
          createdAt: CREATED_AT,
        },
      });
    }

    await resetSequence(queryInterface, 'rating_policy_versions', transaction);
    await resetSequence(queryInterface, 'rating_policy_bands', transaction);
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await runQuery(queryInterface, {
      transaction,
      sql: 'DELETE FROM rating_policy_bands WHERE policy_version_id = :id;',
      replacements: { id: POLICY_VERSION_ID },
    });
    await runQuery(queryInterface, {
      transaction,
      sql: 'DELETE FROM rating_policy_versions WHERE _id = :id;',
      replacements: { id: POLICY_VERSION_ID },
    });
  });
}
