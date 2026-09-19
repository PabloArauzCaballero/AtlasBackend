/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza devuelve al catálogo de permisos lo que el código ya exige y la base no tenía.
 * @system sincroniza internal_permissions y sus concesiones por rol con la lista canónica del código.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';
import { INTERNAL_PERMISSION_SEEDS, ROLE_PERMISSION_CODES } from '../../modules/internal-users/internal-rbac.permissions.js';

type MigrationContext = { context: QueryInterface };

const PERMISSIONS = `${atlasSchemaFor('internal_permissions')}.internal_permissions`;
const ROLES = `${atlasSchemaFor('internal_roles')}.internal_roles`;
const ROLE_PERMISSIONS = `${atlasSchemaFor('internal_role_permissions')}.internal_role_permissions`;

/**
 * El catálogo de permisos se quedó atrás, y con él un endpoint entero inalcanzable.
 *
 * `POST /merchant/users` exige `merchant.users.manage`. El permiso está en la lista canónica del
 * código (`internal-rbac.permissions.ts`) y asignado al rol `MERCHANT_OPERATIONS`… pero **no existe
 * en la base**: había 47 filas en `internal_permissions` frente a las que el código declara. El
 * resultado es un 403 para todo el mundo, incluido `SUPER_ADMIN` — no se puede dar de alta la
 * identidad de un comercio por ningún camino.
 *
 * ## Por qué migración y no sembrador
 *
 * El sembrador de RBAC hace exactamente esto y es idempotente, pero está **registrado como
 * aplicado**: cada permiso que el código añade después de aquella corrida no llega nunca. Y
 * `seed.js up` empieza truncando las tablas de aplicación, así que reejecutarlo para recuperar dos
 * filas de catálogo se llevaría por delante los clientes, los expedientes y los préstamos.
 *
 * La migración es el único camino que corre sobre una base viva. Que el catálogo de permisos viaje
 * como migración no es una anomalía: es referencia, no datos de negocio — sin él el código no
 * funciona, igual que sin una columna.
 *
 * ## Sincroniza todo, no sólo lo que faltaba hoy
 *
 * Insertar únicamente los dos permisos de comercio dejaría el mismo problema para el siguiente. Se
 * recorre la lista canónica entera con `ON CONFLICT DO UPDATE`, de modo que la base converge a lo
 * que el código declara y esta clase de agujero deja de poder abrirse en silencio.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const now = new Date().toISOString();

  for (const permission of INTERNAL_PERMISSION_SEEDS) {
    await queryInterface.sequelize.query(
      `
INSERT INTO ${PERMISSIONS} (
  permission_code, module_code, resource_code, action_code, description, risk_level,
  requires_reason, requires_mfa, is_system_permission, status, _created_at, _updated_at, _deleted
)
VALUES (
  :permissionCode, :moduleCode, :resourceCode, :actionCode, :description, :riskLevel,
  :requiresReason, false, true, 'active', :now, :now, false
)
ON CONFLICT (permission_code) WHERE _deleted = false
DO UPDATE SET
  module_code = EXCLUDED.module_code,
  resource_code = EXCLUDED.resource_code,
  action_code = EXCLUDED.action_code,
  description = EXCLUDED.description,
  risk_level = EXCLUDED.risk_level,
  requires_reason = EXCLUDED.requires_reason,
  status = 'active',
  _updated_at = EXCLUDED._updated_at;`,
      {
        replacements: {
          permissionCode: permission.code,
          moduleCode: permission.module,
          resourceCode: permission.resource,
          actionCode: permission.action,
          description: permission.description,
          riskLevel: permission.riskLevel,
          requiresReason: permission.requiresReason,
          now,
        },
      },
    );
  }

  for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSION_CODES)) {
    for (const permissionCode of permissionCodes) {
      await queryInterface.sequelize.query(
        `
INSERT INTO ${ROLE_PERMISSIONS} (role_id, permission_id, created_by_internal_user_id, _created_at)
SELECT r._id, p._id, NULL, :now
FROM ${ROLES} r
JOIN ${PERMISSIONS} p ON p.permission_code = :permissionCode AND p._deleted = false
WHERE r.role_code = :roleCode AND r._deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        { replacements: { roleCode, permissionCode, now } },
      );
    }
  }
}

/**
 * No revierte.
 *
 * Quitar permisos que el código exige dejaría la API en el mismo 403 del que esta migración salió,
 * y no hay forma de saber cuáles de las filas actuales existían antes: la sincronización es
 * convergente, no un delta. Deshacer un catálogo de referencia no es volver atrás, es romper.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
