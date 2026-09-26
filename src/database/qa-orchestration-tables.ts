/**
 * @file Catálogo de tablas: las del motor de journeys QA, registradas en `platform_ops`.
 * @business Esta pieza guarda aparte las tablas de corridas QA de N personas.
 * @system lista importada por `domain-tables.ts`; vive aparte para no engordar ese archivo.
 */
export const QA_ORCHESTRATION_TABLES = [
  'qa_run_plans',
  'qa_runs',
  'qa_persona_runs',
  'qa_step_runs',
  'qa_run_events',
  'qa_run_resources',
  'qa_run_secrets',
  'qa_worker_heartbeats',
] as const;
