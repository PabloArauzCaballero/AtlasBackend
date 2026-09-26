/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza guarda las corridas QA de N personas de forma durable: cerrar el portal o
 *   reiniciar el worker no pierde el progreso ni la evidencia.
 * @system tablas `qa_*` en `platform_ops`, aditivas; el trabajo se encola en `system_job_runs`.
 *
 * Decisiones de mapeo respecto del plan (sección 5.3):
 *
 * - `qa_step_runs.attempts_json` guarda los intentos del paso en vez de una tabla `qa_step_attempts`
 *   aparte. Cada paso tiene pocos intentos acotados por su `retry`; separarlos en filas no añade una
 *   consulta que el portal necesite y sí una escritura por intento. La unicidad por intento la da el
 *   índice del array (el ejecutor numera `attempt` desde 1 sin huecos).
 * - Los resultados de las personas NO van en el JSON del job (`system_job_runs.result_json`): una
 *   corrida de miles de personas lo convertiría en un documento enorme reescrito en cada checkpoint.
 * - `qa_run_secrets` guarda cifrado (`encryptSecret`) sólo el `runToken` del mock. Los tokens de las
 *   personas NO se persisten: tras un reinicio, la persona vuelve a iniciar sesión con sus
 *   credenciales deterministas, que se regeneran desde semilla + ordinal + namespace.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('qa_runs');
const PLANS = `${SCHEMA}.qa_run_plans`;
const RUNS = `${SCHEMA}.qa_runs`;
const PERSONAS = `${SCHEMA}.qa_persona_runs`;
const STEPS = `${SCHEMA}.qa_step_runs`;
const EVENTS = `${SCHEMA}.qa_run_events`;
const RESOURCES = `${SCHEMA}.qa_run_resources`;
const SECRETS = `${SCHEMA}.qa_run_secrets`;
const WORKERS = `${SCHEMA}.qa_worker_heartbeats`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const run = (sql: string) => queryInterface.sequelize.query(sql);

  // Plan congelado por el preflight. Vive 15 minutos; ejecutar exige el mismo hash.
  await run(`CREATE TABLE IF NOT EXISTS ${PLANS} (
    _id bigserial PRIMARY KEY,
    _tenant_id bigint NOT NULL,
    operator_id varchar(120) NOT NULL,
    plan_hash char(64) NOT NULL,
    plan_json jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    _created_at timestamptz NOT NULL DEFAULT now()
  );`);

  await run(`CREATE TABLE IF NOT EXISTS ${RUNS} (
    _id bigserial PRIMARY KEY,
    _tenant_id bigint NOT NULL,
    operator_id varchar(120) NOT NULL,
    idempotency_key varchar(120) NOT NULL,
    plan_id bigint NOT NULL,
    plan_hash char(64) NOT NULL,
    plan_snapshot jsonb NOT NULL,
    recipe_hash char(64) NOT NULL,
    template_code varchar(120) NOT NULL,
    template_version varchar(40) NOT NULL,
    workflow_code varchar(120) NOT NULL,
    environment_id varchar(80) NOT NULL,
    status varchar(32) NOT NULL,
    verdict varchar(16),
    seed varchar(200) NOT NULL,
    namespace varchar(80) NOT NULL,
    reference_date date NOT NULL,
    generator_version varchar(60) NOT NULL,
    job_run_id bigint,
    parent_run_id bigint,
    counters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    requests_issued integer NOT NULL DEFAULT 0,
    error_message text,
    cancel_requested_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    _created_at timestamptz NOT NULL DEFAULT now(),
    _updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_qa_runs_status CHECK (status IN ('QUEUED','PREFLIGHT','RUNNING','CANCELLING','COMPLETED','CANCELLED','BLOCKED','FAILED_INFRASTRUCTURE','TIMED_OUT')),
    CONSTRAINT ck_qa_runs_verdict CHECK (verdict IS NULL OR verdict IN ('PASSED','FAILED','INCONCLUSIVE'))
  );`);
  // Idempotencia acotada a tenant + operador + operación: la misma clave de otro operador es otra cosa.
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_runs_idempotency ON ${RUNS} (_tenant_id, operator_id, idempotency_key);`);
  await run(`CREATE INDEX IF NOT EXISTS ix_qa_runs_tenant_created ON ${RUNS} (_tenant_id, _created_at DESC);`);

  await run(`CREATE TABLE IF NOT EXISTS ${PERSONAS} (
    _id bigserial PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES ${RUNS}(_id) ON DELETE CASCADE,
    ordinal integer NOT NULL,
    persona_key varchar(40) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'PENDING',
    case_category varchar(20),
    archetype varchar(40),
    dataset_hash char(64),
    resources_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    failed_step_key varchar(120),
    reason text,
    started_at timestamptz,
    finished_at timestamptz,
    CONSTRAINT ck_qa_persona_status CHECK (status IN ('PENDING','RUNNING','PASSED','FAILED','BLOCKED','INDETERMINATE','CANCELLED'))
  );`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_persona_runs_ordinal ON ${PERSONAS} (run_id, ordinal);`);
  await run(`CREATE INDEX IF NOT EXISTS ix_qa_persona_runs_status ON ${PERSONAS} (run_id, status);`);

  await run(`CREATE TABLE IF NOT EXISTS ${STEPS} (
    _id bigserial PRIMARY KEY,
    persona_run_id bigint NOT NULL REFERENCES ${PERSONAS}(_id) ON DELETE CASCADE,
    run_id bigint NOT NULL,
    step_key varchar(120) NOT NULL,
    workflow_step_code varchar(120),
    visit_index integer NOT NULL DEFAULT 0,
    logical_operation_id char(32) NOT NULL,
    status varchar(24) NOT NULL,
    branch varchar(160),
    reason text,
    root_cause_step_key varchar(120),
    failures_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    attempts_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at timestamptz,
    finished_at timestamptz,
    CONSTRAINT ck_qa_step_status CHECK (status IN ('PENDING','RUNNING','PASSED','FAILED','SKIPPED_DEPENDENCY','NOT_APPLICABLE','INDETERMINATE','CANCELLED'))
  );`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_step_runs_visit ON ${STEPS} (persona_run_id, step_key, visit_index);`);
  await run(`CREATE INDEX IF NOT EXISTS ix_qa_step_runs_run ON ${STEPS} (run_id, step_key, status);`);

  await run(`CREATE TABLE IF NOT EXISTS ${EVENTS} (
    _id bigserial PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES ${RUNS}(_id) ON DELETE CASCADE,
    sequence integer NOT NULL,
    event_type varchar(60) NOT NULL,
    payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    _created_at timestamptz NOT NULL DEFAULT now()
  );`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_run_events_sequence ON ${EVENTS} (run_id, sequence);`);

  await run(`CREATE TABLE IF NOT EXISTS ${RESOURCES} (
    _id bigserial PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES ${RUNS}(_id) ON DELETE CASCADE,
    persona_key varchar(40),
    service varchar(60) NOT NULL,
    resource_type varchar(60) NOT NULL,
    resource_id varchar(120) NOT NULL,
    cleanup_strategy varchar(40) NOT NULL DEFAULT 'retain',
    cleanup_result varchar(40),
    _created_at timestamptz NOT NULL DEFAULT now()
  );`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_run_resources ON ${RESOURCES} (run_id, service, resource_type, resource_id);`);

  await run(`CREATE TABLE IF NOT EXISTS ${SECRETS} (
    run_id bigint PRIMARY KEY REFERENCES ${RUNS}(_id) ON DELETE CASCADE,
    mock_run_token_encrypted text,
    mock_epoch varchar(64),
    expires_at timestamptz NOT NULL,
    _created_at timestamptz NOT NULL DEFAULT now()
  );`);

  // Readiness REAL del worker: un proceso encendido que no consume la cola no cuenta. El consumidor
  // escribe aquí en cada vuelta; `capabilities` exige un latido reciente para ofrecer ejecutar.
  await run(`CREATE TABLE IF NOT EXISTS ${WORKERS} (
    worker_id varchar(160) PRIMARY KEY,
    last_seen_at timestamptz NOT NULL,
    version varchar(80),
    _created_at timestamptz NOT NULL DEFAULT now()
  );`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const table of [WORKERS, SECRETS, RESOURCES, EVENTS, STEPS, PERSONAS, RUNS, PLANS]) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${table};`);
  }
}
