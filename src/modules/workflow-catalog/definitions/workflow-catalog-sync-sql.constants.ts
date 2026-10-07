/**
 * @file Constantes: sentencias SQL del volcado del catálogo de procesos.
 * @business Esta pieza guarda en un solo sitio cómo se escribe un proceso en la base, para que el volcado y su revisión lean lo mismo.
 * @system upserts por clave natural de `workflow_definitions`, `workflow_stages` y `workflow_steps` que usa `syncWorkflowCatalog`.
 */
import { atlasSchemaFor } from '../../../database/domain-schemas.js';

export const DEFINITIONS = `${atlasSchemaFor('workflow_definitions')}.workflow_definitions`;
export const STAGES = `${atlasSchemaFor('workflow_stages')}.workflow_stages`;
export const STEPS = `${atlasSchemaFor('workflow_steps')}.workflow_steps`;
export const DEPENDENCIES = `${atlasSchemaFor('workflow_step_dependencies')}.workflow_step_dependencies`;
export const TRANSITIONS = `${atlasSchemaFor('workflow_transitions')}.workflow_transitions`;
export const SYNC = `${atlasSchemaFor('workflow_definitions_sync')}.workflow_definitions_sync`;

export const DEFINITION_UPSERT_SQL = `
INSERT INTO ${DEFINITIONS} (
  workflow_code, version, name, description, process_type, owner_domain, status, is_default,
  entry_stage_code, terminal_stage_codes, success_criteria_json, failure_criteria_json, metadata_json,
  source, created_by, updated_by, narrative_json, owner_role, priority, process_id,
  instance_entity_json, system_codes_json, _created_at, _updated_at, _deleted
) VALUES (
  :code, :version, :name, :description, :processType, :ownerDomain, 'active', true,
  :entry, CAST(:terminals AS JSONB), CAST(:success AS JSONB), CAST(:failure AS JSONB), CAST(:metadata AS JSONB),
  'code', :appliedBy, :appliedBy, CAST(:narrative AS JSONB), :ownerRole, :priority, :processId,
  CAST(:instance AS JSONB), CAST(:systems AS JSONB), :now, :now, false
)
ON CONFLICT (workflow_code, version) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, process_type = EXCLUDED.process_type,
  owner_domain = EXCLUDED.owner_domain, status = 'active', is_default = true, entry_stage_code = EXCLUDED.entry_stage_code,
  terminal_stage_codes = EXCLUDED.terminal_stage_codes, success_criteria_json = EXCLUDED.success_criteria_json,
  failure_criteria_json = EXCLUDED.failure_criteria_json, metadata_json = EXCLUDED.metadata_json,
  source = 'code', updated_by = EXCLUDED.updated_by, narrative_json = EXCLUDED.narrative_json,
  owner_role = EXCLUDED.owner_role, priority = EXCLUDED.priority, process_id = EXCLUDED.process_id,
  instance_entity_json = EXCLUDED.instance_entity_json, system_codes_json = EXCLUDED.system_codes_json,
  _updated_at = EXCLUDED._updated_at, _deleted = false
RETURNING _id;`;

/** Desmarca las demás versiones del código ANTES del upsert: el índice único parcial se comprueba en cada sentencia. */
export const UNSET_OTHER_DEFAULTS_SQL = `UPDATE ${DEFINITIONS} SET is_default = false, _updated_at = NOW()
  WHERE workflow_code = :code AND version <> :version AND is_default = true AND _deleted = false;`;

/** Un proceso que el código ya no declara deja de ofrecerse: se depreca y pierde la marca de predeterminado. */
export const RETIRE_UNDECLARED_DEFINITIONS_SQL = `UPDATE ${DEFINITIONS} SET status = 'deprecated', is_default = false, _updated_at = NOW()
  WHERE source = 'code' AND _deleted = false AND status <> 'deprecated' AND workflow_code NOT IN (:codes);`;

export const STAGE_UPSERT_SQL = `
INSERT INTO ${STAGES} (
  workflow_definition_id, parent_stage_id, stage_code, name, description, module_code, actor_type, display_order,
  is_optional, is_entry_stage, is_terminal_stage, allowed_roles_json, required_states_json, resulting_states_json,
  completion_rule_json, metadata_json, client_code, screen_route, external_link_template, _created_at, _updated_at, _deleted
) VALUES (
  :definitionId, :parentId, :code, :name, :description, :module, :actor, :order,
  :optional, :entry, :terminal, CAST(:roles AS JSONB), CAST(:required AS JSONB), CAST(:resulting AS JSONB),
  CAST(:completion AS JSONB), '{}'::jsonb, :client, :screen, :link, :now, :now, false
)
ON CONFLICT (workflow_definition_id, stage_code) DO UPDATE SET
  parent_stage_id = EXCLUDED.parent_stage_id, name = EXCLUDED.name, description = EXCLUDED.description,
  module_code = EXCLUDED.module_code, actor_type = EXCLUDED.actor_type, display_order = EXCLUDED.display_order,
  is_optional = EXCLUDED.is_optional, is_entry_stage = EXCLUDED.is_entry_stage, is_terminal_stage = EXCLUDED.is_terminal_stage,
  allowed_roles_json = EXCLUDED.allowed_roles_json, required_states_json = EXCLUDED.required_states_json,
  resulting_states_json = EXCLUDED.resulting_states_json, completion_rule_json = EXCLUDED.completion_rule_json,
  client_code = EXCLUDED.client_code, screen_route = EXCLUDED.screen_route,
  external_link_template = EXCLUDED.external_link_template, _updated_at = EXCLUDED._updated_at, _deleted = false
RETURNING _id;`;

export const STEP_UPSERT_SQL = `
INSERT INTO ${STEPS} (
  workflow_definition_id, workflow_stage_id, step_code, name, description, endpoint_code, http_method, route_path,
  execution_order, is_mandatory, is_repeatable, requires_idempotency_key, requires_auth, is_flow_entry, is_flow_exit,
  allowed_roles_json, required_states_json, resulting_states_json, input_contract_json, output_contract_json,
  validation_rules_json, possible_errors_json, retry_strategy_json, produces_events_json, consumes_events_json,
  success_criteria_json, failure_criteria_json, metadata_json, system_code, step_kind, job_code, _created_at, _updated_at, _deleted
) VALUES (
  :definitionId, :stageId, :code, :name, :description, :endpointCode, :method, :path,
  :order, :mandatory, :repeatable, :idempotency, :auth, :entry, :exit,
  CAST(:roles AS JSONB), CAST(:required AS JSONB), CAST(:resulting AS JSONB), CAST(:input AS JSONB), CAST(:output AS JSONB),
  '[]'::jsonb, CAST(:errors AS JSONB), CAST(:retry AS JSONB), CAST(:events AS JSONB), CAST(:consumes AS JSONB),
  CAST(:success AS JSONB), '{}'::jsonb, CAST(:metadata AS JSONB), :system, :kind, :job, :now, :now, false
)
ON CONFLICT (workflow_definition_id, step_code) DO UPDATE SET
  workflow_stage_id = EXCLUDED.workflow_stage_id, name = EXCLUDED.name, description = EXCLUDED.description,
  endpoint_code = EXCLUDED.endpoint_code, http_method = EXCLUDED.http_method, route_path = EXCLUDED.route_path,
  execution_order = EXCLUDED.execution_order, is_mandatory = EXCLUDED.is_mandatory, is_repeatable = EXCLUDED.is_repeatable,
  requires_idempotency_key = EXCLUDED.requires_idempotency_key, requires_auth = EXCLUDED.requires_auth,
  is_flow_entry = EXCLUDED.is_flow_entry, is_flow_exit = EXCLUDED.is_flow_exit, allowed_roles_json = EXCLUDED.allowed_roles_json,
  required_states_json = EXCLUDED.required_states_json, resulting_states_json = EXCLUDED.resulting_states_json,
  input_contract_json = EXCLUDED.input_contract_json, output_contract_json = EXCLUDED.output_contract_json,
  possible_errors_json = EXCLUDED.possible_errors_json, retry_strategy_json = EXCLUDED.retry_strategy_json,
  produces_events_json = EXCLUDED.produces_events_json, consumes_events_json = EXCLUDED.consumes_events_json,
  success_criteria_json = EXCLUDED.success_criteria_json, metadata_json = EXCLUDED.metadata_json,
  system_code = EXCLUDED.system_code, step_kind = EXCLUDED.step_kind, job_code = EXCLUDED.job_code,
  _updated_at = EXCLUDED._updated_at, _deleted = false
RETURNING _id;`;

export const DEPENDENCY_INSERT_SQL = `INSERT INTO ${DEPENDENCIES} (workflow_definition_id, step_id, depends_on_step_id, dependency_type, description, _created_at, _updated_at)
  VALUES (:definitionId, :stepId, :dependsOn, :type, :description, NOW(), NOW()) ON CONFLICT DO NOTHING;`;

export const TRANSITION_INSERT_SQL = `INSERT INTO ${TRANSITIONS} (workflow_definition_id, transition_code, from_step_id, to_step_id, condition_type,
    condition_expression_json, description, display_order, is_default_path, _created_at, _updated_at)
  VALUES (:definitionId, :code, :from, :to, :condition, CAST(:expression AS JSONB), :description, :order, :isDefault, NOW(), NOW());`;

export const SYNC_RETIRE_SQL = `DELETE FROM ${SYNC} WHERE workflow_code NOT IN (:codes);`;

export const SYNC_UPSERT_SQL = `INSERT INTO ${SYNC} (workflow_code, version, content_hash, applied_by, applied_at)
  VALUES (:code, :version, :hash, :appliedBy, NOW())
  ON CONFLICT (workflow_code) DO UPDATE SET version = EXCLUDED.version, content_hash = EXCLUDED.content_hash,
    applied_by = EXCLUDED.applied_by, applied_at = EXCLUDED.applied_at;`;
