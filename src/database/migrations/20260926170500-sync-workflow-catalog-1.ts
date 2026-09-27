/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Sin esto, un proceso existe en el código y NO en la base: el portal no lo enseña y en producción el catálogo sale vacío.
 * @system vuelca `WORKFLOW_DEFINITIONS` con `syncWorkflowCatalog` (idempotente, en una transacción).
 */
import { QueryInterface } from 'sequelize';
import { WORKFLOW_DEFINITIONS } from '../../modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../modules/workflow-catalog/definitions/workflow-catalog.sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `sync-internal-rbac-catalog-N`: el catálogo se declara en código y cada cambio
 * trae su migración que lo vuelve a volcar. Hasta hoy los procesos vivían en la siembra demo, que es
 * opt-in desde `0009e4b`: una base sin `db:seed:demo` —producción— no tenía ninguno.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20260926170500-sync-workflow-catalog-1');
}

/**
 * Sin vuelta atrás: retirar procesos que la siembra y el runtime también referencian dejaría la base
 * en un estado que nadie declaró. Deshacer el esquema lo hace `workflow-catalog-v2`.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
