/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Las fichas de «Señales de dispositivo y sesiones», «Evaluación de riesgo del alta» y «Elegibilidad y ciclo de vida del cliente» citan los servicios reales tras dividir `runtime-jobs.service.ts` y `operations.service.ts` por caso de uso.
 * @system vuelca `WORKFLOW_DEFINITIONS` con `syncWorkflowCatalog` (idempotente, en una transacción).
 */
import { QueryInterface } from 'sequelize';
import { WORKFLOW_DEFINITIONS } from '../../modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../modules/workflow-catalog/definitions/workflow-catalog.sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `sync-workflow-catalog-1..11`. Recoge el cambio de tres procesos: la lista de archivos apunta al servicio de
 * expiración de sesiones y al de decisión de revisión manual en lugar de los `runtime-jobs.service.ts` y `operations.service.ts`
 * retirados. Sólo escribe filas del catálogo `workflow_*`; el refactor no cambia rutas ni comportamiento.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20261015140000-sync-workflow-catalog-12');
}

/** Sin vuelta atrás, como `sync-workflow-catalog-1`: el volcado anterior es un subconjunto de éste. */
export async function down(): Promise<void> {
  return Promise.resolve();
}
