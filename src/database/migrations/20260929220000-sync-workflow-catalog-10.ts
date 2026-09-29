/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El catálogo de procesos dice la verdad sobre los avisos: no promete avisos de mora que nadie envía y sí el aviso interno de plazos de soporte.
 * @system vuelca `WORKFLOW_DEFINITIONS` con `syncWorkflowCatalog` (idempotente, en una transacción).
 */
import { QueryInterface } from 'sequelize';
import { WORKFLOW_DEFINITIONS } from '../../modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../modules/workflow-catalog/definitions/workflow-catalog.sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `sync-workflow-catalog-1..9`. Recoge los cambios de «Notificaciones transaccionales y
 * campañas masivas», «Soporte: casos, chat, mesa de ayuda, SLA…» y «Soporte de comercios»: las reglas de
 * aviso sin productor (mora, vencimientos…) dejan de afirmarse y el aviso interno de plazos de soporte
 * (`support.sla.warning` / `support.sla.breached`) pasa a documentarse como lo que es. Sólo escribe filas
 * del catálogo `workflow_*`.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20260929220000-sync-workflow-catalog-10');
}

/** Sin vuelta atrás, como `sync-workflow-catalog-1`: el volcado anterior es un subconjunto de éste. */
export async function down(): Promise<void> {
  return Promise.resolve();
}
