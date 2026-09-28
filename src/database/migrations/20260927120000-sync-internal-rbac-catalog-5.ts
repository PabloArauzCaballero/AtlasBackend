/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Sin esto, un permiso nuevo existe en el código y NO en la base: la pantalla que depende de él responde 403.
 * @system vuelve a volcar el catálogo RBAC interno (permisos y concesiones por rol) desde el código.
 */
import { QueryInterface } from 'sequelize';
import { syncInternalRbacCatalog } from '../../modules/internal-users/internal-rbac.catalog-sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo motivo que `20260926171000-sync-internal-rbac-catalog-4`: el volcado de `20260821040000`
 * ya corrió, así que todo permiso declarado después —aquí `privacy.requests.read` y
 * `privacy.requests.manage`, la cola de solicitudes del titular (hallazgo A5)— vive sólo en el
 * código hasta que una migración lo vuelva a volcar. Sin ella, la pantalla responde 403 a todos.
 *
 * Es el MISMO volcado, idempotente (`ON CONFLICT`), a través de `syncInternalRbacCatalog`: actualiza
 * los permisos existentes, inserta los que falten y concede los que su rol declare. No revoca nada.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncInternalRbacCatalog(queryInterface);
}

/**
 * Sin vuelta atrás, por el mismo motivo que `20260915140000-sync-internal-rbac-catalog-2`: revocar
 * permisos que otras migraciones y seeds también conceden dejaría la base en un estado que nadie
 * declaró.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
