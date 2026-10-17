/**
 * @file Migración: da de alta el permiso de ver las sesiones abiertas del personal.
 * @business Sin esto, «Sesiones activas» respondería 403 a todo el mundo, incluso a SUPER_ADMIN.
 * @system vuelve a volcar el catálogo RBAC interno (permisos y concesiones por rol) desde el código.
 */
import { QueryInterface } from 'sequelize';
import { syncInternalRbacCatalog } from '../../modules/internal-users/internal-rbac.catalog-sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * `internal.sessions.read` nace el 2026-10-17 y el volcado del catálogo ya corrió en todos los entornos.
 * Es el MISMO volcado, idempotente (`ON CONFLICT DO NOTHING` en las concesiones): no revoca nada.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncInternalRbacCatalog(queryInterface);
}

/**
 * Sin vuelta atrás (no-op documentado), por el mismo motivo que `20260915140000-sync-internal-rbac-catalog-2`:
 * revocar permisos que otras migraciones y seeds también conceden dejaría la base en un estado que nadie declaró.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
