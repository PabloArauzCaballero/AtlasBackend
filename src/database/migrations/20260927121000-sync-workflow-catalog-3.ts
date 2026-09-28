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
 * Mismo volcado que `20260926170500-sync-workflow-catalog-1` y `-2`, idempotente. Lo trae el cambio de P-35
 * (hallazgo A4): proponer y aprobar cambios de esquema pasan a poder hacerse desde el portal interno
 * con `governance.schema.*`, y la ficha deja de declarar ese hueco.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20260927121000-sync-workflow-catalog-3');
}

/**
 * Sin vuelta atrás: retirar procesos que la siembra y el runtime también referencian dejaría la base
 * en un estado que nadie declaró. Deshacer el esquema lo hace `workflow-catalog-v2`.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
