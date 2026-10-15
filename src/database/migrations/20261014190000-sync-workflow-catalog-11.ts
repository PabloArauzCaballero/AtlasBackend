/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business La ficha del proceso «Operación de proveedores externos» cita los controllers reales tras partir `external-data.controller.ts` por subrecurso.
 * @system vuelca `WORKFLOW_DEFINITIONS` con `syncWorkflowCatalog` (idempotente, en una transacción).
 */
import { QueryInterface } from 'sequelize';
import { WORKFLOW_DEFINITIONS } from '../../modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../modules/workflow-catalog/definitions/workflow-catalog.sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `sync-workflow-catalog-1..10`. Recoge el cambio de «Operación de proveedores externos»: la lista de archivos
 * del proceso apunta a los seis controllers por subrecurso en lugar del `external-data.controller.ts` retirado. Sólo escribe
 * filas del catálogo `workflow_*`; el refactor no cambia rutas ni comportamiento.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20261014190000-sync-workflow-catalog-11');
}

/** Sin vuelta atrás, como `sync-workflow-catalog-1`: el volcado anterior es un subconjunto de éste. */
export async function down(): Promise<void> {
  return Promise.resolve();
}
