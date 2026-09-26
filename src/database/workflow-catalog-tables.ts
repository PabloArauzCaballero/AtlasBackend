/**
 * @file Catálogo de tablas: las del catálogo de procesos, registradas en `platform_ops`.
 * @business Esta pieza guarda aparte las tablas de los procesos de negocio declarados en código.
 * @system lista importada por `domain-tables.ts`; vive aparte para no engordar ese archivo.
 */
export const WORKFLOW_CATALOG_TABLES = [
  'workflow_definitions',
  'workflow_stages',
  'workflow_steps',
  'workflow_step_dependencies',
  'workflow_transitions',
  // Huella de qué versión del código de cada proceso tiene la base (`syncWorkflowCatalog`).
  'workflow_definitions_sync',
] as const;
