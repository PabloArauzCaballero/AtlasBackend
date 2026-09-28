/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Quién lee y quién cambia los avisos y el contenido de la app queda alineado con el catálogo RBAC: los procesos P-13 y de gobierno de datos lo cuentan.
 * @system vuelca `WORKFLOW_DEFINITIONS` con `syncWorkflowCatalog` (idempotente, en una transacción).
 */
import { QueryInterface } from 'sequelize';
import { WORKFLOW_DEFINITIONS } from '../../modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../modules/workflow-catalog/definitions/workflow-catalog.sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `sync-workflow-catalog-1..6`: el catálogo se declara en código y cada cambio trae su
 * migración que lo vuelve a volcar. Ésta recoge los roles nuevos de «Políticas de notificación»,
 * «Contenido de la app» y la lectura de mensajes y plantillas: cumplimiento y auditoría leen, y sólo
 * administración escribe lo que se le dice al cliente.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20260928220000-sync-workflow-catalog-7');
}

/** Sin vuelta atrás, como `sync-workflow-catalog-1`: el volcado anterior es un subconjunto de éste. */
export async function down(): Promise<void> {
  return Promise.resolve();
}
