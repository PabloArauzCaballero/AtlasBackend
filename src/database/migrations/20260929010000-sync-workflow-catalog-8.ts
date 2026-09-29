/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El alta pide sólo los quince datos que fijó el dueño (eligibility-v2): referencias personales y encuesta de hábitos dejan de ser pasos obligatorios, y gastos y origen de fondos dejan de exigirse; el catálogo de procesos lo cuenta.
 * @system vuelca `WORKFLOW_DEFINITIONS` con `syncWorkflowCatalog` (idempotente, en una transacción).
 */
import { QueryInterface } from 'sequelize';
import { WORKFLOW_DEFINITIONS } from '../../modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../modules/workflow-catalog/definitions/workflow-catalog.sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `sync-workflow-catalog-1..7`: el catálogo se declara en código y cada cambio trae su
 * migración que lo vuelve a volcar. Ésta recoge P-02, P-05 y el recorrido del cliente con la regla
 * eligibility-v2: las etapas de referencias y encuesta pasan a opcionales y `REFERENCES_INSUFFICIENT`
 * sale de los bloqueadores de la captura de datos. Sólo escribe filas del catálogo `workflow_*`.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20260929010000-sync-workflow-catalog-8');
}

/** Sin vuelta atrás, como `sync-workflow-catalog-1`: el volcado anterior es un subconjunto de éste. */
export async function down(): Promise<void> {
  return Promise.resolve();
}
