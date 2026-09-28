/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El extracto que el Motor manda a revisión humana ya vuelve a Atlas (A6) y el aviso de identidad se reintenta (A7): los procesos P-07 y P-03 lo cuentan.
 * @system vuelca `WORKFLOW_DEFINITIONS` con `syncWorkflowCatalog` (idempotente, en una transacción).
 */
import { QueryInterface } from 'sequelize';
import { WORKFLOW_DEFINITIONS } from '../../modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../modules/workflow-catalog/definitions/workflow-catalog.sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `sync-workflow-catalog-1..4`: el catálogo se declara en código y cada cambio trae su
 * migración que lo vuelve a volcar. Ésta recoge la vuelta de la revisión humana de extractos
 * (`/internal/credit/bank-statement-review-callback` y la relectura del job) y el aviso de identidad
 * con reintentos por el outbox del Motor.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncWorkflowCatalog(queryInterface, WORKFLOW_DEFINITIONS, 'migration:20260928011000-sync-workflow-catalog-5');
}

/** Sin vuelta atrás, como `sync-workflow-catalog-1`: el volcado anterior es un subconjunto de éste. */
export async function down(): Promise<void> {
  return Promise.resolve();
}
