/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Publica los dos recorridos de acceso —alta de cuenta y arranque de la app— para que
 * cliente y portal lean el mismo árbol de endpoints en vez de deducirlo.
 * @system define production para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface, QueryTypes, Transaction } from 'sequelize';
import { buildEndpointCode } from '../../../modules/systems-ops/endpoint-code.util.js';
import type { WorkflowSeed, WorkflowStageSeed, WorkflowStepSeed } from '../../seed-data/customer-credit-workflow.seed-data.js';
import { SIGNUP_TO_LOGIN_WORKFLOW } from '../../seed-data/signup-to-login-workflow.seed-data.js';
import { POST_LOGIN_FIRST_SCREEN_WORKFLOW } from '../../seed-data/post-login-first-screen-workflow.seed-data.js';

/**
 * `customer_credit_journey` cubre el proceso de negocio de punta a punta, pero deja fuera los dos
 * tramos que más se preguntan: qué endpoints toca un usuario para CREARSE la cuenta hasta quedar
 * logueado, y qué se llama entre el login y la primera pantalla. Sin ellos, el catálogo respondía
 * "el recorrido" en singular cuando en realidad hay varios.
 *
 * La mecánica de upsert está escrita aquí en vez de reutilizar la del seeder del recorrido de
 * crédito porque sus funciones son privadas de aquel archivo, que además sigue sin commitear en la
 * rama de otro agente. Cuando ese trabajo aterrice, lo natural es extraer un
 * `workflow-catalog-seeder.util.ts` y que los dos seeders lo llamen (anotado en AGENT-COORDINATION).
 */

const SEEDED_BY = 'seed:20260729010000-seed-access-journey-workflows';
const WORKFLOWS: readonly WorkflowSeed[] = [SIGNUP_TO_LOGIN_WORKFLOW, POST_LOGIN_FIRST_SCREEN_WORKFLOW];

type FlatStage = { seed: WorkflowStageSeed; parentStageCode: string | null };

function flattenStages(stages: readonly WorkflowStageSeed[], parentStageCode: string | null = null): FlatStage[] {
  return stages.flatMap((stage) => [{ seed: stage, parentStageCode }, ...flattenStages(stage.subStages ?? [], stage.stageCode)]);
}

async function upsertDefinition(qi: QueryInterface, workflow: WorkflowSeed, transaction: Transaction): Promise<string> {
  const rows = (await qi.sequelize.query(
    `
    INSERT INTO workflow_definitions (
      workflow_code, version, name, description, process_type, owner_domain, status, is_default,
      entry_stage_code, terminal_stage_codes, success_criteria_json, failure_criteria_json,
      metadata_json, source, created_by, updated_by, _created_at, _updated_at, _deleted
    ) VALUES (
      :workflowCode, :version, :name, :description, :processType, :ownerDomain, :status, :isDefault,
      :entryStageCode, CAST(:terminalStageCodes AS JSONB), CAST(:successCriteria AS JSONB), CAST(:failureCriteria AS JSONB),
      CAST(:metadata AS JSONB), 'seed', :seededBy, :seededBy, NOW(), NOW(), false
    )
    ON CONFLICT (workflow_code, version) DO UPDATE SET
      name = EXCLUDED.name, description = EXCLUDED.description, process_type = EXCLUDED.process_type,
      owner_domain = EXCLUDED.owner_domain, status = EXCLUDED.status, is_default = EXCLUDED.is_default,
      entry_stage_code = EXCLUDED.entry_stage_code, terminal_stage_codes = EXCLUDED.terminal_stage_codes,
      success_criteria_json = EXCLUDED.success_criteria_json, failure_criteria_json = EXCLUDED.failure_criteria_json,
      metadata_json = EXCLUDED.metadata_json, updated_by = EXCLUDED.updated_by, _updated_at = NOW(), _deleted = false
    RETURNING _id;
    `,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: {
        workflowCode: workflow.workflowCode,
        version: workflow.version,
        name: workflow.name,
        description: workflow.description,
        processType: workflow.processType,
        ownerDomain: workflow.ownerDomain,
        status: workflow.status,
        isDefault: workflow.isDefault,
        entryStageCode: workflow.entryStageCode,
        terminalStageCodes: JSON.stringify(workflow.terminalStageCodes),
        successCriteria: JSON.stringify(workflow.successCriteria),
        failureCriteria: JSON.stringify(workflow.failureCriteria),
        metadata: JSON.stringify(workflow.metadata),
        seededBy: SEEDED_BY,
      },
    },
  )) as Array<{ _id: string }>;
  return String(rows[0]._id);
}

async function upsertStages(
  qi: QueryInterface,
  definitionId: string,
  flatStages: readonly FlatStage[],
  transaction: Transaction,
): Promise<Map<string, string>> {
  const idByCode = new Map<string, string>();
  for (const { seed } of flatStages) {
    const rows = (await qi.sequelize.query(
      `
      INSERT INTO workflow_stages (
        workflow_definition_id, parent_stage_id, stage_code, name, description, module_code, actor_type,
        display_order, is_optional, is_entry_stage, is_terminal_stage, allowed_roles_json,
        required_states_json, resulting_states_json, completion_rule_json, metadata_json,
        _created_at, _updated_at, _deleted
      ) VALUES (
        :definitionId, NULL, :stageCode, :name, :description, :moduleCode, :actorType,
        :displayOrder, :isOptional, :isEntryStage, :isTerminalStage, CAST(:allowedRoles AS JSONB),
        CAST(:requiredStates AS JSONB), CAST(:resultingStates AS JSONB), CAST(:completionRule AS JSONB), '{}'::jsonb,
        NOW(), NOW(), false
      )
      ON CONFLICT (workflow_definition_id, stage_code) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description, module_code = EXCLUDED.module_code,
        actor_type = EXCLUDED.actor_type, display_order = EXCLUDED.display_order, is_optional = EXCLUDED.is_optional,
        is_entry_stage = EXCLUDED.is_entry_stage, is_terminal_stage = EXCLUDED.is_terminal_stage,
        allowed_roles_json = EXCLUDED.allowed_roles_json, required_states_json = EXCLUDED.required_states_json,
        resulting_states_json = EXCLUDED.resulting_states_json, completion_rule_json = EXCLUDED.completion_rule_json,
        _updated_at = NOW(), _deleted = false
      RETURNING _id;
      `,
      {
        transaction,
        type: QueryTypes.SELECT,
        replacements: {
          definitionId,
          stageCode: seed.stageCode,
          name: seed.name,
          description: seed.description,
          moduleCode: seed.moduleCode,
          actorType: seed.actorType,
          displayOrder: seed.displayOrder,
          isOptional: seed.isOptional ?? false,
          isEntryStage: seed.isEntryStage ?? false,
          isTerminalStage: seed.isTerminalStage ?? false,
          allowedRoles: JSON.stringify(seed.allowedRoles ?? []),
          requiredStates: JSON.stringify(seed.requiredStates ?? []),
          resultingStates: JSON.stringify(seed.resultingStates ?? []),
          completionRule: JSON.stringify(seed.completionRule),
        },
      },
    )) as Array<{ _id: string }>;
    idByCode.set(seed.stageCode, String(rows[0]._id));
  }

  // Segunda pasada: el padre sólo puede enlazarse cuando todas las etapas tienen `_id`.
  for (const { seed, parentStageCode } of flatStages) {
    await qi.sequelize.query(`UPDATE workflow_stages SET parent_stage_id = :parentId, _updated_at = NOW() WHERE _id = :stageId;`, {
      transaction,
      replacements: {
        parentId: parentStageCode === null ? null : (idByCode.get(parentStageCode) ?? null),
        stageId: idByCode.get(seed.stageCode),
      },
    });
  }
  return idByCode;
}

function stepReplacements(
  definitionId: string,
  stageIdByCode: Map<string, string>,
  stage: WorkflowStageSeed,
  step: WorkflowStepSeed,
): Record<string, unknown> {
  return {
    definitionId,
    stageId: stageIdByCode.get(stage.stageCode),
    stepCode: step.stepCode,
    name: step.name,
    description: step.description,
    // Derivado, nunca escrito a mano: coincide por construcción con el catálogo técnico.
    endpointCode: buildEndpointCode(step.httpMethod, step.routePath),
    httpMethod: step.httpMethod,
    routePath: step.routePath,
    executionOrder: step.executionOrder,
    isMandatory: step.isMandatory ?? true,
    isRepeatable: step.isRepeatable ?? false,
    requiresIdempotencyKey: step.requiresIdempotencyKey ?? false,
    requiresAuth: step.requiresAuth ?? true,
    isFlowEntry: step.isFlowEntry ?? false,
    isFlowExit: step.isFlowExit ?? false,
    allowedRoles: JSON.stringify(step.allowedRoles),
    requiredStates: JSON.stringify(step.requiredStates ?? stage.requiredStates ?? []),
    resultingStates: JSON.stringify(step.resultingStates ?? []),
    inputContract: JSON.stringify(step.inputContract ?? {}),
    outputContract: JSON.stringify(step.outputContract ?? {}),
    validationRules: JSON.stringify(step.validationRules ?? []),
    possibleErrors: JSON.stringify(step.possibleErrors ?? []),
    retryStrategy: JSON.stringify(step.retryStrategy ?? {}),
    producesEvents: JSON.stringify(step.producesEvents ?? []),
    consumesEvents: JSON.stringify(step.consumesEvents ?? []),
    successCriteria: JSON.stringify(step.successCriteria ?? {}),
    failureCriteria: JSON.stringify(step.failureCriteria ?? {}),
  };
}

async function upsertSteps(
  qi: QueryInterface,
  definitionId: string,
  flatStages: readonly FlatStage[],
  stageIdByCode: Map<string, string>,
  transaction: Transaction,
): Promise<Map<string, string>> {
  const idByCode = new Map<string, string>();
  for (const { seed: stage } of flatStages) {
    for (const step of stage.steps) {
      const rows = (await qi.sequelize.query(
        `
        INSERT INTO workflow_steps (
          workflow_definition_id, workflow_stage_id, step_code, name, description, endpoint_code,
          http_method, route_path, execution_order, is_mandatory, is_repeatable, requires_idempotency_key,
          requires_auth, is_flow_entry, is_flow_exit, allowed_roles_json, required_states_json,
          resulting_states_json, input_contract_json, output_contract_json, validation_rules_json,
          possible_errors_json, retry_strategy_json, produces_events_json, consumes_events_json,
          success_criteria_json, failure_criteria_json, metadata_json, _created_at, _updated_at, _deleted
        ) VALUES (
          :definitionId, :stageId, :stepCode, :name, :description, :endpointCode,
          :httpMethod, :routePath, :executionOrder, :isMandatory, :isRepeatable, :requiresIdempotencyKey,
          :requiresAuth, :isFlowEntry, :isFlowExit, CAST(:allowedRoles AS JSONB), CAST(:requiredStates AS JSONB),
          CAST(:resultingStates AS JSONB), CAST(:inputContract AS JSONB), CAST(:outputContract AS JSONB), CAST(:validationRules AS JSONB),
          CAST(:possibleErrors AS JSONB), CAST(:retryStrategy AS JSONB), CAST(:producesEvents AS JSONB), CAST(:consumesEvents AS JSONB),
          CAST(:successCriteria AS JSONB), CAST(:failureCriteria AS JSONB), '{}'::jsonb, NOW(), NOW(), false
        )
        ON CONFLICT (workflow_definition_id, step_code) DO UPDATE SET
          workflow_stage_id = EXCLUDED.workflow_stage_id, name = EXCLUDED.name, description = EXCLUDED.description,
          endpoint_code = EXCLUDED.endpoint_code, http_method = EXCLUDED.http_method, route_path = EXCLUDED.route_path,
          execution_order = EXCLUDED.execution_order, is_mandatory = EXCLUDED.is_mandatory,
          is_repeatable = EXCLUDED.is_repeatable, requires_idempotency_key = EXCLUDED.requires_idempotency_key,
          requires_auth = EXCLUDED.requires_auth, is_flow_entry = EXCLUDED.is_flow_entry, is_flow_exit = EXCLUDED.is_flow_exit,
          allowed_roles_json = EXCLUDED.allowed_roles_json, required_states_json = EXCLUDED.required_states_json,
          resulting_states_json = EXCLUDED.resulting_states_json, input_contract_json = EXCLUDED.input_contract_json,
          output_contract_json = EXCLUDED.output_contract_json, validation_rules_json = EXCLUDED.validation_rules_json,
          possible_errors_json = EXCLUDED.possible_errors_json, retry_strategy_json = EXCLUDED.retry_strategy_json,
          produces_events_json = EXCLUDED.produces_events_json, consumes_events_json = EXCLUDED.consumes_events_json,
          success_criteria_json = EXCLUDED.success_criteria_json, failure_criteria_json = EXCLUDED.failure_criteria_json,
          _updated_at = NOW(), _deleted = false
        RETURNING _id;
        `,
        { transaction, type: QueryTypes.SELECT, replacements: stepReplacements(definitionId, stageIdByCode, stage, step) },
      )) as Array<{ _id: string }>;
      idByCode.set(step.stepCode, String(rows[0]._id));
    }
  }
  return idByCode;
}

async function syncGraph(
  qi: QueryInterface,
  workflow: WorkflowSeed,
  definitionId: string,
  stepIdByCode: Map<string, string>,
  transaction: Transaction,
): Promise<void> {
  // Aristas puras, sin identidad propia: se reemplazan enteras en vez de marcarse borradas.
  await qi.sequelize.query(`DELETE FROM workflow_step_dependencies WHERE workflow_definition_id = :definitionId;`, {
    transaction,
    replacements: { definitionId },
  });
  for (const dependency of workflow.dependencies) {
    const stepId = stepIdByCode.get(dependency.stepCode);
    const dependsOnStepId = stepIdByCode.get(dependency.dependsOnStepCode);
    if (!stepId || !dependsOnStepId) continue;
    await qi.sequelize.query(
      `INSERT INTO workflow_step_dependencies (workflow_definition_id, step_id, depends_on_step_id, dependency_type, description, _created_at, _updated_at)
       VALUES (:definitionId, :stepId, :dependsOnStepId, :dependencyType, :description, NOW(), NOW());`,
      {
        transaction,
        replacements: {
          definitionId,
          stepId,
          dependsOnStepId,
          dependencyType: dependency.dependencyType,
          description: dependency.description,
        },
      },
    );
  }

  await qi.sequelize.query(`DELETE FROM workflow_transitions WHERE workflow_definition_id = :definitionId;`, {
    transaction,
    replacements: { definitionId },
  });
  for (const transition of workflow.transitions) {
    await qi.sequelize.query(
      `INSERT INTO workflow_transitions (workflow_definition_id, transition_code, from_step_id, to_step_id, condition_type,
        condition_expression_json, description, display_order, is_default_path, _created_at, _updated_at)
       VALUES (:definitionId, :transitionCode, :fromStepId, :toStepId, :conditionType,
        CAST(:conditionExpression AS JSONB), :description, :displayOrder, :isDefaultPath, NOW(), NOW());`,
      {
        transaction,
        replacements: {
          definitionId,
          transitionCode: transition.transitionCode,
          fromStepId: transition.fromStepCode === null ? null : (stepIdByCode.get(transition.fromStepCode) ?? null),
          toStepId: transition.toStepCode === null ? null : (stepIdByCode.get(transition.toStepCode) ?? null),
          conditionType: transition.conditionType,
          conditionExpression: JSON.stringify(transition.conditionExpression ?? {}),
          description: transition.description,
          displayOrder: transition.displayOrder,
          isDefaultPath: transition.isDefaultPath ?? false,
        },
      },
    );
  }
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  for (const workflow of WORKFLOWS) {
    const flatStages = flattenStages(workflow.stages);
    await queryInterface.sequelize.transaction(async (transaction) => {
      const definitionId = await upsertDefinition(queryInterface, workflow, transaction);
      const stageIdByCode = await upsertStages(queryInterface, definitionId, flatStages, transaction);
      const stepIdByCode = await upsertSteps(queryInterface, definitionId, flatStages, stageIdByCode, transaction);
      await syncGraph(queryInterface, workflow, definitionId, stepIdByCode, transaction);
      console.log(
        `[workflow-catalog] ${workflow.workflowCode}@${workflow.version} sembrado: ${flatStages.length} etapas, ` +
          `${stepIdByCode.size} pasos, ${workflow.dependencies.length} dependencias, ${workflow.transitions.length} transiciones.`,
      );
    });
  }
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  // Las cinco tablas cuelgan de la definición con ON DELETE CASCADE.
  for (const workflow of WORKFLOWS) {
    await queryInterface.sequelize.query(`DELETE FROM workflow_definitions WHERE workflow_code = :workflowCode AND version = :version;`, {
      replacements: { workflowCode: workflow.workflowCode, version: workflow.version },
    });
  }
}
