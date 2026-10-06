/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Sin esto, un permiso nuevo existe en el código y NO en la base: la pantalla que depende de él responde 403.
 * @system vuelve a volcar el catálogo RBAC interno (permisos y concesiones por rol) desde el código.
 */
import { QueryInterface } from 'sequelize';
import { syncInternalRbacCatalog } from '../../modules/internal-users/internal-rbac.catalog-sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo motivo que `20260928010000-sync-internal-rbac-catalog-6`: el volcado de `20260821040000` ya
 * corrió, así que `partner.kyb.decide` y `customers.eligibility.decide` —las decisiones manuales sobre
 * el expediente de un comercio y la habilitación de un cliente, que antes sólo pedían el rol de
 * aplicación `internal_operator`— viven sólo en el código hasta que una
 * migración lo vuelva a volcar. Sin ella, nadie (ni SUPER_ADMIN) podría decidir: 403 para todos.
 *
 * Es el MISMO volcado, idempotente (`ON CONFLICT`), a través de `syncInternalRbacCatalog`.
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
