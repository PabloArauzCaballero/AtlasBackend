/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define production para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface, Transaction } from 'sequelize';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from '../../../modules/internal-users/internal-rbac.seed-data.js';

/**
 * Da de alta los permisos de las vistas nuevas: salud de la RED y artefactos activos del motor.
 *
 * ## Por qué un seeder aparte y no editar el baseline
 *
 * `20260704121000-seed-internal-rbac.ts` es idempotente, pero Umzug lo registra por NOMBRE: en
 * cualquier instalación que ya lo aplicó, editarlo no vuelve a ejecutarlo. Los permisos nuevos
 * quedarían en el código y no en la base, y el síntoma sería el peor posible — el portal enseñando
 * el menú y respondiendo 403 al entrar, sin nada en los logs que explicara por qué.
 *
 * ## Por qué sólo estos tres códigos
 *
 * Se recorren únicamente los permisos que este cambio introduce, y se les asigna el rol que ya los
 * tendría según la matriz (`SUPER_ADMIN` los tiene todos; `SYSTEMS_ADMIN`, todo lo que empieza por
 * `systems.`). Reaplicar la matriz entera desde aquí revertiría cualquier ajuste de permisos hecho
 * a mano en una instalación viva, que no es asunto de este cambio.
 */
const CREATED_AT = new Date('2026-08-20T00:00:00.000Z');

const NEW_PERMISSION_CODES = ['systems.network.read', 'systems.network.federate', 'systems.decisionEngine.artifacts.read'];

type QueryParams = { sql: string; replacements?: Record<string, unknown>; transaction: Transaction };

async function runQuery(queryInterface: QueryInterface, input: QueryParams): Promise<void> {
  await queryInterface.sequelize.query(input.sql, { replacements: input.replacements, transaction: input.transaction });
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const permissions = INTERNAL_PERMISSION_SEEDS.filter((item) => NEW_PERMISSION_CODES.includes(item.code));

  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const permission of permissions) {
      await runQuery(queryInterface, {
        transaction,
        sql: `
          INSERT INTO internal_permissions (
            permission_code, module_code, resource_code, action_code, description, risk_level,
            requires_reason, requires_mfa, is_system_permission, status, _created_at, _updated_at, _deleted
          ) VALUES (
            :permissionCode, :moduleCode, :resourceCode, :actionCode, :description, :riskLevel,
            :requiresReason, false, true, 'active', :createdAt, :createdAt, false
          )
          ON CONFLICT (permission_code) WHERE _deleted = false
          DO UPDATE SET description = EXCLUDED.description, status = 'active', _updated_at = EXCLUDED._updated_at;
        `,
        replacements: {
          permissionCode: permission.code,
          moduleCode: permission.module,
          resourceCode: permission.resource,
          actionCode: permission.action,
          description: permission.description,
          riskLevel: permission.riskLevel,
          requiresReason: permission.requiresReason,
          createdAt: CREATED_AT,
        },
      });
    }

    for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSION_CODES)) {
      for (const permissionCode of NEW_PERMISSION_CODES) {
        if (!permissionCodes.includes(permissionCode)) continue;
        await runQuery(queryInterface, {
          transaction,
          sql: `
            INSERT INTO internal_role_permissions (role_id, permission_id, created_by_internal_user_id, _created_at)
            SELECT r._id, p._id, NULL, :createdAt
            FROM internal_roles r
            JOIN internal_permissions p ON p.permission_code = :permissionCode AND p._deleted = false
            WHERE r.role_code = :roleCode AND r._deleted = false
            ON CONFLICT (role_id, permission_id) DO NOTHING;
          `,
          replacements: { roleCode, permissionCode, createdAt: CREATED_AT },
        });
      }
    }
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await runQuery(queryInterface, {
      transaction,
      sql: `
        DELETE FROM internal_role_permissions
         WHERE permission_id IN (SELECT _id FROM internal_permissions WHERE permission_code IN (:codes));
      `,
      replacements: { codes: NEW_PERMISSION_CODES },
    });
    await runQuery(queryInterface, {
      transaction,
      sql: `DELETE FROM internal_permissions WHERE permission_code IN (:codes);`,
      replacements: { codes: NEW_PERMISSION_CODES },
    });
  });
}
