/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Una incidencia de calidad reconocida sigue pendiente hasta que se corrige o se descarta con motivo; el catálogo de procesos lo cuenta así.
 * @system vuelca `WORKFLOW_DEFINITIONS` con `syncWorkflowCatalog` (idempotente, en una transacción).
 */
import { QueryInterface } from 'sequelize';
import { WORKFLOW_DEFINITIONS } from '../../modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../modules/workflow-catalog/definitions/workflow-catalog.sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `sync-workflow-catalog-1..8`. Recoge el cambio de «Gobierno de datos, calidad y
 * reportes»: el indicador de salud y los estados abiertos de la instancia cuentan `acknowledged` como
 * pendiente (reconocer ya no cierra la incidencia) y dejan de contar `ignored`. Sólo escribe filas del
 * catálogo `workflow_*`.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20260929120000-sync-workflow-catalog-9');
}

/** Sin vuelta atrás, como `sync-workflow-catalog-1`: el volcado anterior es un subconjunto de éste. */
export async function down(): Promise<void> {
  return Promise.resolve();
}
