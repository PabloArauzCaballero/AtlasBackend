/**
 * @file Migración: concede a sus roles las decisiones manuales de KYB y de elegibilidad.
 * @business Sin esto, cumplimiento y riesgo recibirían 403 al decidir un expediente de comercio o la habilitación de un cliente.
 * @system vuelve a volcar el catálogo RBAC interno (permisos y concesiones por rol) desde el código.
 */
import { QueryInterface } from 'sequelize';
import { syncInternalRbacCatalog } from '../../modules/internal-users/internal-rbac.catalog-sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * `20261006104000-sync-internal-rbac-catalog-7` ya pudo correr en algún entorno antes de que el código
 * repartiera `partner.kyb.decide` (COMPLIANCE_MANAGER, COMPLIANCE_ANALYST, RISK_MANAGER) y
 * `customers.eligibility.decide` (RISK_MANAGER, RISK_ANALYST) entre roles. Es el MISMO volcado,
 * idempotente (`ON CONFLICT DO NOTHING` en las concesiones): no revoca nada.
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
