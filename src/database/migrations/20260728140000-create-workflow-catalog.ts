/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const DEFINITIONS = `${atlasSchemaFor('workflow_definitions')}.workflow_definitions`;
const STAGES = `${atlasSchemaFor('workflow_stages')}.workflow_stages`;
const STEPS = `${atlasSchemaFor('workflow_steps')}.workflow_steps`;
const DEPENDENCIES = `${atlasSchemaFor('workflow_step_dependencies')}.workflow_step_dependencies`;
const TRANSITIONS = `${atlasSchemaFor('workflow_transitions')}.workflow_transitions`;

/**
 * Catálogo de flujos de trabajo: el árbol de endpoints que compone un proceso de negocio.
 *
 * El backend ya sabía QUÉ endpoints expone (`system_endpoint_catalog`, poblado por descubrimiento)
 * pero no EN QUÉ ORDEN se recorren ni bajo qué condiciones se pasa de uno al siguiente. Ese
 * conocimiento vivía repartido entre prosa de `docs/endpoints/endpoints.md`, la lógica de
 * `CustomerEligibilityService` y lo que cada cliente HTTP hubiera codificado por su cuenta. Estas
 * cinco tablas lo convierten en dato consultable y versionado.
 *
 * Decisiones de diseño:
 *
 * 1. **Es catálogo de la plataforma, no de un tenant.** El árbol describe el software desplegado
 *    (rutas, métodos, roles del sistema de autorización), no la operación de un cliente concreto;
 *    por eso no lleva `_tenant_id`, igual que `system_endpoint_catalog`. Lo que sí es por tenant es
 *    el AVANCE de un cliente dentro del flujo, y eso se deriva en tiempo real de sus propios datos.
 *
 * 2. **Versionado por fila, no por columna mutable.** La unicidad es `(workflow_code, version)`: una
 *    versión nueva es un conjunto nuevo de filas y las anteriores quedan intactas en estado
 *    `deprecated`. Un flujo ya recorrido sigue siendo explicable aunque la definición cambie.
 *
 * 3. **Etapas jerárquicas.** `parent_stage_id` modela subflujos sin tablas adicionales: la captura de
 *    datos del onboarding es una etapa con seis subetapas, y un flujo futuro puede anidar más sin
 *    cambiar la estructura.
 *
 * 4. **Transiciones como filas, no como columnas `next_step_id`.** Un paso puede tener varias salidas
 *    (éxito, error, condicional) y varias entradas. Modelarlo con un par de columnas obliga a
 *    reestructurar en cuanto aparece la primera bifurcación real — y en este backend ya existen
 *    (`submit` va a revisión humana o a habilitación automática según los bloqueadores).
 *
 * 5. **`endpoint_code` es una referencia lógica, no una FK.** Apunta al `code` de
 *    `system_endpoint_catalog`, que se puebla por descubrimiento en runtime y puede estar vacío en
 *    una instalación recién migrada. Una FK física haría que el orden de seeding decidiera si el
 *    catálogo de flujos puede existir. La coherencia se verifica —y se reporta— con el informe de
 *    consistencia del módulo, que compara contra las rutas realmente expuestas por Nest.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${DEFINITIONS} (
  _id                    BIGSERIAL PRIMARY KEY,
  workflow_code          VARCHAR(80)  NOT NULL,
  version                VARCHAR(20)  NOT NULL,
  name                   VARCHAR(180) NOT NULL,
  description            TEXT,
  process_type           VARCHAR(60)  NOT NULL,
  owner_domain           VARCHAR(80)  NOT NULL,
  status                 VARCHAR(20)  NOT NULL DEFAULT 'draft',
  is_default             BOOLEAN      NOT NULL DEFAULT false,
  entry_stage_code       VARCHAR(80),
  terminal_stage_codes   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  success_criteria_json  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  failure_criteria_json  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  metadata_json          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  source                 VARCHAR(40)  NOT NULL DEFAULT 'seed',
  effective_from         TIMESTAMPTZ,
  effective_until        TIMESTAMPTZ,
  created_by             VARCHAR(120),
  updated_by             VARCHAR(120),
  _created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _deleted               BOOLEAN      NOT NULL DEFAULT false
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_definitions_status') THEN
    ALTER TABLE ${DEFINITIONS} ADD CONSTRAINT ck_workflow_definitions_status
      CHECK (status IN ('draft','active','deprecated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_definitions_source') THEN
    ALTER TABLE ${DEFINITIONS} ADD CONSTRAINT ck_workflow_definitions_source
      CHECK (source IN ('seed','manual','discovery'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_definitions_effective_range') THEN
    ALTER TABLE ${DEFINITIONS} ADD CONSTRAINT ck_workflow_definitions_effective_range
      CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from);
  END IF;
END
$$;
`);

  // Clave natural del catálogo: el seeder la usa como target del ON CONFLICT, así que sin este
  // índice el upsert idempotente no tendría dónde apoyarse.
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_definitions_code_version
  ON ${DEFINITIONS} (workflow_code, version);
`);

  // Un solo flujo por defecto por código. Sin esto, "¿cuál es el flujo estándar?" tendría dos
  // respuestas posibles en cuanto alguien publicara una versión nueva sin retirar la anterior.
  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_definitions_default_per_code
  ON ${DEFINITIONS} (workflow_code) WHERE is_default = true AND _deleted = false;
`);

  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_workflow_definitions_status
  ON ${DEFINITIONS} (status, process_type) WHERE _deleted = false;
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${STAGES} (
  _id                     BIGSERIAL PRIMARY KEY,
  workflow_definition_id  BIGINT       NOT NULL REFERENCES ${DEFINITIONS} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  parent_stage_id         BIGINT       REFERENCES ${STAGES} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  stage_code              VARCHAR(80)  NOT NULL,
  name                    VARCHAR(180) NOT NULL,
  description             TEXT,
  module_code             VARCHAR(80)  NOT NULL,
  actor_type              VARCHAR(40)  NOT NULL,
  display_order           INTEGER      NOT NULL,
  is_optional             BOOLEAN      NOT NULL DEFAULT false,
  is_entry_stage          BOOLEAN      NOT NULL DEFAULT false,
  is_terminal_stage       BOOLEAN      NOT NULL DEFAULT false,
  allowed_roles_json      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  required_states_json    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  resulting_states_json   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  completion_rule_json    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  metadata_json           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  _created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _deleted                BOOLEAN      NOT NULL DEFAULT false
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_stages_actor_type') THEN
    ALTER TABLE ${STAGES} ADD CONSTRAINT ck_workflow_stages_actor_type
      CHECK (actor_type IN ('customer','internal_user','system','external_provider'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_stages_not_self_parent') THEN
    ALTER TABLE ${STAGES} ADD CONSTRAINT ck_workflow_stages_not_self_parent
      CHECK (parent_stage_id IS NULL OR parent_stage_id <> _id);
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_stages_definition_code
  ON ${STAGES} (workflow_definition_id, stage_code);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_workflow_stages_definition_order
  ON ${STAGES} (workflow_definition_id, display_order) WHERE _deleted = false;
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_workflow_stages_parent
  ON ${STAGES} (parent_stage_id) WHERE parent_stage_id IS NOT NULL;
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${STEPS} (
  _id                       BIGSERIAL PRIMARY KEY,
  workflow_definition_id    BIGINT        NOT NULL REFERENCES ${DEFINITIONS} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  workflow_stage_id         BIGINT        NOT NULL REFERENCES ${STAGES} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  step_code                 VARCHAR(120)  NOT NULL,
  name                      VARCHAR(200)  NOT NULL,
  description               TEXT,
  endpoint_code             VARCHAR(180)  NOT NULL,
  http_method               VARCHAR(10)   NOT NULL,
  route_path                TEXT          NOT NULL,
  execution_order           INTEGER       NOT NULL,
  is_mandatory              BOOLEAN       NOT NULL DEFAULT true,
  is_repeatable             BOOLEAN       NOT NULL DEFAULT false,
  requires_idempotency_key  BOOLEAN       NOT NULL DEFAULT false,
  requires_auth             BOOLEAN       NOT NULL DEFAULT true,
  is_flow_entry             BOOLEAN       NOT NULL DEFAULT false,
  is_flow_exit              BOOLEAN       NOT NULL DEFAULT false,
  allowed_roles_json        JSONB         NOT NULL DEFAULT '[]'::jsonb,
  required_states_json      JSONB         NOT NULL DEFAULT '[]'::jsonb,
  resulting_states_json     JSONB         NOT NULL DEFAULT '[]'::jsonb,
  input_contract_json       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  output_contract_json      JSONB         NOT NULL DEFAULT '{}'::jsonb,
  validation_rules_json     JSONB         NOT NULL DEFAULT '[]'::jsonb,
  possible_errors_json      JSONB         NOT NULL DEFAULT '[]'::jsonb,
  retry_strategy_json       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  produces_events_json      JSONB         NOT NULL DEFAULT '[]'::jsonb,
  consumes_events_json      JSONB         NOT NULL DEFAULT '[]'::jsonb,
  success_criteria_json     JSONB         NOT NULL DEFAULT '{}'::jsonb,
  failure_criteria_json     JSONB         NOT NULL DEFAULT '{}'::jsonb,
  metadata_json             JSONB         NOT NULL DEFAULT '{}'::jsonb,
  _created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _deleted                  BOOLEAN       NOT NULL DEFAULT false
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_steps_http_method') THEN
    ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_http_method
      CHECK (http_method IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_steps_route_path') THEN
    ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_route_path
      CHECK (route_path LIKE '/%');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_steps_execution_order') THEN
    ALTER TABLE ${STEPS} ADD CONSTRAINT ck_workflow_steps_execution_order
      CHECK (execution_order > 0);
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_steps_definition_code
  ON ${STEPS} (workflow_definition_id, step_code);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_workflow_steps_stage_order
  ON ${STEPS} (workflow_stage_id, execution_order) WHERE _deleted = false;
`);
  // El informe de consistencia entra por `endpoint_code`; el filtro por método+ruta lo usa el
  // buscador "¿en qué flujos participa este endpoint?" del portal interno.
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_workflow_steps_endpoint_code
  ON ${STEPS} (endpoint_code) WHERE _deleted = false;
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${DEPENDENCIES} (
  _id                     BIGSERIAL PRIMARY KEY,
  workflow_definition_id  BIGINT       NOT NULL REFERENCES ${DEFINITIONS} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  step_id                 BIGINT       NOT NULL REFERENCES ${STEPS} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  depends_on_step_id      BIGINT       NOT NULL REFERENCES ${STEPS} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  dependency_type         VARCHAR(40)  NOT NULL DEFAULT 'requires_completion',
  description             TEXT,
  _created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_step_dependencies_type') THEN
    ALTER TABLE ${DEPENDENCIES} ADD CONSTRAINT ck_workflow_step_dependencies_type
      CHECK (dependency_type IN ('requires_completion','requires_data','soft'));
  END IF;
  -- Un paso que depende de sí mismo es un ciclo trivial: se impide en la base, no solo en el seeder.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_step_dependencies_not_self') THEN
    ALTER TABLE ${DEPENDENCIES} ADD CONSTRAINT ck_workflow_step_dependencies_not_self
      CHECK (step_id <> depends_on_step_id);
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_step_dependencies_pair
  ON ${DEPENDENCIES} (step_id, depends_on_step_id);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_workflow_step_dependencies_definition
  ON ${DEPENDENCIES} (workflow_definition_id);
`);

  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${TRANSITIONS} (
  _id                        BIGSERIAL PRIMARY KEY,
  workflow_definition_id     BIGINT        NOT NULL REFERENCES ${DEFINITIONS} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  transition_code            VARCHAR(140)  NOT NULL,
  from_step_id               BIGINT        REFERENCES ${STEPS} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  to_step_id                 BIGINT        REFERENCES ${STEPS} (_id) ON DELETE CASCADE ON UPDATE CASCADE,
  condition_type             VARCHAR(40)   NOT NULL DEFAULT 'on_success',
  condition_expression_json  JSONB         NOT NULL DEFAULT '{}'::jsonb,
  description                TEXT,
  display_order              INTEGER       NOT NULL DEFAULT 1,
  is_default_path            BOOLEAN       NOT NULL DEFAULT false,
  _created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
`);

  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_transitions_condition_type') THEN
    ALTER TABLE ${TRANSITIONS} ADD CONSTRAINT ck_workflow_transitions_condition_type
      CHECK (condition_type IN ('always','on_success','on_error','on_state','conditional'));
  END IF;
  -- Una transición sin origen ni destino no describe nada. NULL en un extremo sí es significativo:
  -- entrada al flujo (sin origen) o salida del flujo (sin destino).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_transitions_endpoints') THEN
    ALTER TABLE ${TRANSITIONS} ADD CONSTRAINT ck_workflow_transitions_endpoints
      CHECK (from_step_id IS NOT NULL OR to_step_id IS NOT NULL);
  END IF;
END
$$;
`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_transitions_definition_code
  ON ${TRANSITIONS} (workflow_definition_id, transition_code);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_workflow_transitions_from_step
  ON ${TRANSITIONS} (from_step_id, display_order);
`);
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_workflow_transitions_to_step
  ON ${TRANSITIONS} (to_step_id);
`);

  // Mismo criterio de mínimo privilegio que el resto del esquema: el rol de runtime lee y escribe,
  // pero no crea objetos. Las tablas son nuevas, así que hay que otorgar explícitamente sobre ellas.
  await queryInterface.sequelize.query(`
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      ${DEFINITIONS}, ${STAGES}, ${STEPS}, ${DEPENDENCIES}, ${TRANSITIONS} TO atlas_app_rw;
    GRANT USAGE, SELECT ON
      ${DEFINITIONS}__id_seq, ${STAGES}__id_seq, ${STEPS}__id_seq,
      ${DEPENDENCIES}__id_seq, ${TRANSITIONS}__id_seq TO atlas_app_rw;
  END IF;
  -- El rol de solo lectura consume exclusivamente las vistas de \`read_api\`; darle SELECT directo
  -- sobre tablas del modelo de escritura rompería esa frontera (mismo criterio que \`credit\`).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app_ro') THEN
    REVOKE ALL ON ${DEFINITIONS}, ${STAGES}, ${STEPS}, ${DEPENDENCIES}, ${TRANSITIONS} FROM atlas_app_ro;
  END IF;
END$$;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TRANSITIONS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${DEPENDENCIES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${STEPS};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${STAGES};`);
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${DEFINITIONS};`);
}
