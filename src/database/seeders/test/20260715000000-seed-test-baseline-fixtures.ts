import { QueryInterface, Transaction } from 'sequelize';

/**
 * Fixtures mínimos y deterministas para el perfil `test`.
 *
 * El perfil `test` corre `production/*` (catálogos de arranque) y luego este archivo. La intención
 * NO es reproducir el grafo demo completo, sino garantizar las precondiciones mínimas que muchas
 * suites comparten: un tenant de prueba con `_id = 1`. Todo lo demás debería crearse con factories
 * dentro de cada test y revertirse por transacción (ver §7.3 del plan).
 *
 * Idempotente por clave natural (`_id`). Debe ejecutarse únicamente contra una base cuyo nombre
 * termine en `_test` o vía allowlist explícita — el runner por perfiles lo verifica.
 */

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const TEST_TENANT_ID = 1;

async function run(
  queryInterface: QueryInterface,
  sql: string,
  replacements: Record<string, unknown>,
  transaction: Transaction,
): Promise<void> {
  await queryInterface.sequelize.query(sql, { replacements, transaction });
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await run(
      queryInterface,
      `
        INSERT INTO tenants (_id, tenant_code, legal_name, country_code, status, _created_at, _updated_at, _deleted)
        VALUES (:id, 'atlas-test', 'Atlas Test Tenant', 'BOL', 'active', :createdAt, :createdAt, false)
        ON CONFLICT (_id) DO UPDATE SET
          tenant_code = EXCLUDED.tenant_code,
          legal_name = EXCLUDED.legal_name,
          country_code = EXCLUDED.country_code,
          status = 'active',
          _updated_at = EXCLUDED._updated_at,
          _deleted = false;
      `,
      { id: TEST_TENANT_ID, createdAt: CREATED_AT },
      transaction,
    );

    await run(
      queryInterface,
      `
        SELECT setval(
          pg_get_serial_sequence('tenants', '_id'),
          GREATEST(COALESCE((SELECT MAX(_id) FROM tenants), 1), 1),
          true
        )
        WHERE pg_get_serial_sequence('tenants', '_id') IS NOT NULL;
      `,
      {},
      transaction,
    );
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await run(queryInterface, `DELETE FROM tenants WHERE _id = :id AND tenant_code = 'atlas-test';`, { id: TEST_TENANT_ID }, transaction);
  });
}
