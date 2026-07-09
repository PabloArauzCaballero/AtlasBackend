import { QueryTypes } from 'sequelize';
import { createSequelizeInstance } from '../src/database/sequelize.js';

/**
 * Fase 2 — smoke test de integridad del "modelo profundo".
 *
 * No reemplaza a `scripts/smoke/*` (que prueban endpoints HTTP). Este script consulta la base de
 * datos directamente para confirmar que, para el cliente demo sembrado por
 * `20260626160720-seed-minimal-dev-credentials.ts` + los seeders de la Fase 1/2
 * (`20260706000000-seed-deep-graph-demo-data.ts`,
 * `20260706010000-seed-external-provider-and-catalog-governance-demo-data.ts`,
 * `20260706020000-seed-schema-constraint-notes.ts`), cada entidad "padre" tiene al menos una fila
 * "hija" asociada. Si algún padre queda sin hijos, el script falla con código de salida 1 y
 * describe exactamente qué relación quedó huérfana, para que sea imposible que la brecha de seeds
 * vuelva a pasar desapercibida.
 *
 * Uso: `yarn tsx scripts/verify-seed-graph-integrity.ts` (requiere DB con migraciones + seeds ya
 * aplicados). Pensado para correr en CI justo después de `db:seed:up`.
 */

type GraphCheck = {
  label: string;
  /** Debe devolver >0 si la relación padre->hijo tiene al menos una fila. */
  sql: string;
};

const CHECKS: GraphCheck[] = [
  // --- Identidad / domicilio ---
  { label: 'customers(1) -> customer_addresses', sql: `SELECT count(*) FROM customer_addresses WHERE customer_id = 1` },
  {
    label: 'customer_addresses(1) -> customer_address_versions',
    sql: `SELECT count(*) FROM customer_address_versions WHERE customer_address_id = 1`,
  },
  {
    label: 'customer_addresses(1) -> address_gps_observations',
    sql: `SELECT count(*) FROM address_gps_observations WHERE customer_address_id = 1`,
  },
  { label: 'customers(1) -> customer_reference_contacts', sql: `SELECT count(*) FROM customer_reference_contacts WHERE customer_id = 1` },
  {
    label: 'customer_contact_methods(1) -> contact_verification_attempts',
    sql: `SELECT count(*) FROM contact_verification_attempts WHERE contact_method_id = 1`,
  },
  {
    label: 'customer_identity_documents(1) -> identity_verification_attempts',
    sql: `SELECT count(*) FROM identity_verification_attempts WHERE identity_document_id = 1`,
  },

  // --- Evidencia KYC ---
  {
    label: 'evidence_documents(1) -> evidence_extractions',
    sql: `SELECT count(*) FROM evidence_extractions WHERE evidence_document_id = 1`,
  },
  { label: 'evidence_documents(1) -> evidence_reviews', sql: `SELECT count(*) FROM evidence_reviews WHERE evidence_document_id = 1` },

  // --- Perfil / observaciones / atributos ---
  { label: 'customers(1) -> customer_attribute_values', sql: `SELECT count(*) FROM customer_attribute_values WHERE customer_id = 1` },
  { label: 'customers(1) -> customer_observations', sql: `SELECT count(*) FROM customer_observations WHERE customer_id = 1` },
  { label: 'customers(1) -> customer_context_enrichments', sql: `SELECT count(*) FROM customer_context_enrichments WHERE customer_id = 1` },
  { label: 'customers(1) -> customer_action_logs', sql: `SELECT count(*) FROM customer_action_logs WHERE customer_id = 1` },
  { label: 'customers(1) -> data_subject_requests', sql: `SELECT count(*) FROM data_subject_requests WHERE customer_id = 1` },

  // --- Dispositivo ---
  { label: 'devices(1) -> device_snapshots', sql: `SELECT count(*) FROM device_snapshots WHERE device_id = 1` },
  { label: 'devices(1) -> device_risk_events', sql: `SELECT count(*) FROM device_risk_events WHERE device_id = 1` },
  { label: 'devices(1) -> sim_observations', sql: `SELECT count(*) FROM sim_observations WHERE device_id = 1` },
  {
    label: 'customer_sessions(1) -> ip_reputation_observations',
    sql: `SELECT count(*) FROM ip_reputation_observations WHERE session_id = 1`,
  },
  { label: 'customers(1) -> device_tokens', sql: `SELECT count(*) FROM device_tokens WHERE customer_id = 1` },

  // --- Onboarding / comportamiento ---
  {
    label: 'onboarding_flows(1) -> onboarding_step_events',
    sql: `SELECT count(*) FROM onboarding_step_events WHERE onboarding_flow_id = 1`,
  },
  {
    label: 'onboarding_flows(1) -> form_field_interaction_events',
    sql: `SELECT count(*) FROM form_field_interaction_events WHERE onboarding_flow_id = 1`,
  },
  { label: 'onboarding_flows(1) -> permission_events', sql: `SELECT count(*) FROM permission_events WHERE onboarding_flow_id = 1` },
  {
    label: 'onboarding_flows(1) -> onboarding_behavior_summaries',
    sql: `SELECT count(*) FROM onboarding_behavior_summaries WHERE onboarding_flow_id = 1`,
  },
  {
    label: 'onboarding_flows(1) -> on_device_computation_runs',
    sql: `SELECT count(*) FROM on_device_computation_runs WHERE onboarding_flow_id = 1`,
  },
  {
    label: 'on_device_computation_runs(1) -> on_device_metric_values',
    sql: `SELECT count(*) FROM on_device_metric_values WHERE computation_run_id = 1`,
  },

  // --- Explicabilidad de riesgo ---
  {
    label: 'risk_assessment_runs(1) -> risk_assessment_contexts',
    sql: `SELECT count(*) FROM risk_assessment_contexts WHERE risk_assessment_run_id = 1`,
  },
  { label: 'risk_assessment_runs(1) -> risk_rules_fired', sql: `SELECT count(*) FROM risk_rules_fired WHERE risk_assessment_run_id = 1` },
  {
    label: 'risk_assessment_runs(1) -> risk_feature_contributions',
    sql: `SELECT count(*) FROM risk_feature_contributions WHERE risk_assessment_run_id = 1`,
  },
  { label: 'risk_assessment_runs(1) -> feature_snapshots', sql: `SELECT count(*) FROM feature_snapshots WHERE risk_assessment_run_id = 1` },
  { label: 'feature_values(101) -> feature_lineage_links', sql: `SELECT count(*) FROM feature_lineage_links WHERE feature_value_id = 101` },

  // --- Fraude / revisión manual / watchlist ---
  { label: 'fraud_cases(1) -> fraud_case_events', sql: `SELECT count(*) FROM fraud_case_events WHERE fraud_case_id = 1` },
  {
    label: 'manual_review_cases(1) -> manual_review_events',
    sql: `SELECT count(*) FROM manual_review_events WHERE manual_review_case_id = 1`,
  },
  { label: 'watchlist_entries(1) -> watchlist_matches', sql: `SELECT count(*) FROM watchlist_matches WHERE watchlist_entry_id = 1` },

  // --- Proveedores externos / gobernanza de catálogo ---
  {
    label: 'data_providers(SEGIP) -> data_provider_requests',
    sql: `SELECT count(*) FROM data_provider_requests dpr JOIN data_providers dp ON dp._id = dpr.provider_id WHERE dp.provider_code = 'SEGIP'`,
  },
  {
    label: 'data_provider_requests(1) -> data_provider_responses',
    sql: `SELECT count(*) FROM data_provider_responses WHERE provider_request_id = 1`,
  },
  {
    label: 'context_ingestion_jobs(1) -> context_staging_items',
    sql: `SELECT count(*) FROM context_staging_items WHERE ingestion_job_id = 1`,
  },
  {
    label: 'context_staging_items(1) -> context_approval_events',
    sql: `SELECT count(*) FROM context_approval_events WHERE staging_item_id = 1`,
  },

  // --- Catálogo de constraints (documentación, sin FK a un padre puntual) ---
  { label: 'schema_constraint_notes tiene filas', sql: `SELECT count(*) FROM schema_constraint_notes` },
];

async function main(): Promise<void> {
  const sequelize = createSequelizeInstance();
  const failures: string[] = [];

  try {
    for (const check of CHECKS) {
      const rows = await sequelize.query<{ count: string }>(check.sql, { type: QueryTypes.SELECT });
      const count = Number(rows[0]?.count ?? 0);

      if (count > 0) {
        console.log(`[OK]   ${check.label} (${count} fila(s))`);
      } else {
        console.error(`[FAIL] ${check.label} -> 0 filas`);
        failures.push(check.label);
      }
    }
  } finally {
    await sequelize.close();
  }

  if (failures.length > 0) {
    console.error(`\n[FAIL] ${failures.length} relación(es) huérfana(s) de ${CHECKS.length} verificadas:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[OK] Integridad del grafo profundo verificada: ${CHECKS.length}/${CHECKS.length} relaciones tienen datos.`);
}

void main();
