/**
 * @file Migración: reparte los permisos de dinero entre sus roles.
 * @business Sin esto, cobranza y riesgo recibirían 403 al registrar cobros o decidir solicitudes.
 * @system vuelve a volcar el catálogo RBAC interno (permisos y concesiones por rol) desde el código.
 */
import { QueryInterface } from 'sequelize';
import { syncInternalRbacCatalog } from '../../modules/internal-users/internal-rbac.catalog-sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * `20261006102000-sync-internal-rbac-catalog-b02-post-merge` ya pudo correr en algún entorno antes de que
 * el código repartiera `loans.payment.register`/`reverse` (COLLECTIONS_AGENT) y `credit.application.decide`
 * (RISK_MANAGER, RISK_ANALYST). Es el MISMO volcado, idempotente (`ON CONFLICT DO NOTHING` en las
 * concesiones): inserta lo que falte y no revoca nada. Quitar del código una concesión (p. ej.
 * `credit.loan.disburse` a OPERATIONS_MANAGER) NO la revoca en una base donde ya se concedió.
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
