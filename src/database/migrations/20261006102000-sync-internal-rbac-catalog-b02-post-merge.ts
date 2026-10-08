/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Sin esto, un permiso nuevo existe en el código y NO en la base: la pantalla que depende de él responde 403.
 * @system vuelve a volcar el catálogo RBAC interno (permisos y concesiones por rol) desde el código.
 */
import { QueryInterface } from 'sequelize';
import { syncInternalRbacCatalog } from '../../modules/internal-users/internal-rbac.catalog-sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Repite el volcado de `20261005102000-sync-internal-rbac-catalog-b02` tras integrar `dev`: ese ya pudo correr
 * (o correrá antes que migraciones de `dev` posteriores). Mismo motivo: el volcado de `20260821040000` ya
 * corrió, así que los permisos declarados después —aquí `credit.application.decide`,
 * `credit.product.manage`, `credit.loan.disburse`, `loans.payment.register` y
 * `loans.payment.reverse`, que sustituyen al rol grueso `internal_operator` en las rutas de dinero—
 * viven sólo en el código hasta que una migración los vuelva a volcar. Sin ella, decidir, desembolsar
 * y cobrar responden 403 a todos, SUPER_ADMIN incluido.
 *
 * Es el MISMO volcado, idempotente (`ON CONFLICT`): inserta los permisos que falten y concede los que
 * su rol declare. No revoca nada.
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
