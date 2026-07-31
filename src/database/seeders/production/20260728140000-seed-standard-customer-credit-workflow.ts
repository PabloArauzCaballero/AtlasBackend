/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system define production para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { QueryInterface, QueryTypes, Transaction } from 'sequelize';
import { buildEndpointCode } from '../../../modules/systems-ops/endpoint-code.util.js';
import {
  CUSTOMER_CREDIT_WORKFLOW,
  WorkflowSeed,
  WorkflowStageSeed,
  WorkflowStepSeed,
} from '../../seed-data/customer-credit-workflow.seed-data.js';

/**
 * Árbol REAL de endpoints del recorrido estándar del cliente (perfil PRODUCTION).
 *
 * Es dato estructural, no operativo: describe el software desplegado (rutas, métodos, roles,
 * estados), no la actividad de ningún cliente. Por eso vive en `production` y no en `demo`: sin
 * estas filas, `GET /workflows/customer_credit_journey` responde 404 en una instalación limpia y el
 * frontend se queda sin la única fuente del recorrido.
 *
 * **Idempotencia y actualización.** Cada tabla se sincroniza contra su clave natural
 * (`workflow_code+version`, `stage_code`, `step_code`, `transition_code`, el par de la dependencia),
 * de modo que reejecutarlo actualiza en vez de duplicar y publicar una definición corregida basta
 * con volver a correrlo. Los identificadores son estables: un `_id` de etapa o paso no cambia entre
 * ejecuciones, así que cualquier referencia externa a ellos sigue siendo válida.
 *
 * **Qué se borra y qué no.** Una etapa o paso que desaparece de la definición se marca `_deleted`,
 * no se elimina: si alguien los referenció, la referencia sigue resolviendo. Transiciones y
 * dependencias sí se eliminan físicamente — son aristas puras sin identidad propia, y dejarlas
 * marcadas obligaría a filtrar por `_deleted` en cada recorrido del grafo. Nada de esto toca datos
 * de clientes: el seeder solo escribe en las cinco tablas del catálogo.
 *
 * **Trazabilidad.** `endpoint_code` NO se escribe a mano: se deriva con `buildEndpointCode`, la
 * misma función que usa el catálogo técnico de endpoints. Así el código del paso y el del endpoint
 * descubierto coinciden por construcción, y el informe de consistencia puede cruzarlos.
 */

const SEEDED_BY = 'seed:20260728140000-seed-standard-customer-credit-workflow';

type FlatStage = { seed: WorkflowStageSeed; parentStageCode: string | null };
type Counters = { created: number; updated: number; softDeleted: number; removed: number };

function flattenStages(stages: readonly WorkflowStageSeed[], parentStageCode: string | null = null): FlatStage[] {
  return stages.flatMap((stage) => [{ seed: stage, parentStageCode }, ...flattenStages(stage.subStages ?? [], stage.stageCode)]);
}

function emptyCounters(): Counters {
  return { created: 0, updated: 0, softDeleted: 0, removed: 0 };
}

function track(counters: Counters, rows: Array<{ inserted: boolean }>): void {
  for (const row of rows) {
    if (row.inserted) counters.created += 1;
    else counters.updated += 1;
  }
}

function logCounters(label: string, counters: Counters): void {
  console.log(
    `[workflow-catalog] ${label}: creados=${counters.created} actualizados=${counters.updated} ` +
      `marcados_borrados=${counters.softDeleted} eliminados=${counters.removed}`,
  );
}

async function upsertDefinition(queryInterface: QueryInterface, workflow: WorkflowSeed, transaction: Transaction): Promise<string> {
  const counters = emptyCounters();
  const rows = (await queryInterface.sequelize.query(
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
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      process_type = EXCLUDED.process_type,
      owner_domain = EXCLUDED.owner_domain,
      status = EXCLUDED.status,
      is_default = EXCLUDED.is_default,
      entry_stage_code = EXCLUDED.entry_stage_code,
      terminal_stage_codes = EXCLUDED.terminal_stage_codes,
      success_criteria_json = EXCLUDED.success_criteria_json,
      failure_criteria_json = EXCLUDED.failure_criteria_json,
      metadata_json = EXCLUDED.metadata_json,
      updated_by = EXCLUDED.updated_by,
      _updated_at = NOW(),
      _deleted = false
    RETURNING _id, (xmax = 0) AS inserted;
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
  )) as Array<{ _id: string; inserted: boolean }>;

  track(counters, rows);
  logCounters(`definición ${workflow.workflowCode}@${workflow.version}`, counters);
  return String(rows[0]._id);
}

async function upsertStages(
  queryInterface: QueryInterface,
  definitionId: string,
  flatStages: readonly FlatStage[],
  transaction: Transaction,
): Promise<Map<string, string>> {
  const counters = emptyCounters();
  const idByCode = new Map<string, string>();

  for (const { seed } of flatStages) {
    const rows = (await queryInterface.sequelize.query(
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
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        module_code = EXCLUDED.module_code,
        actor_type = EXCLUDED.actor_type,
        display_order = EXCLUDED.display_order,
        is_optional = EXCLUDED.is_optional,
        is_entry_stage = EXCLUDED.is_entry_stage,
        is_terminal_stage = EXCLUDED.is_terminal_stage,
        allowed_roles_json = EXCLUDED.allowed_roles_json,
        required_states_json = EXCLUDED.required_states_json,
        resulting_states_json = EXCLUDED.resulting_states_json,
        completion_rule_json = EXCLUDED.completion_rule_json,
        _updated_at = NOW(),
        _deleted = false
      RETURNING _id, (xmax = 0) AS inserted;
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
    )) as Array<{ _id: string; inserted: boolean }>;

    track(counters, rows);
    idByCode.set(seed.stageCode, String(rows[0]._id));
  }

  // Segunda pasada: el padre solo puede enlazarse cuando todas las etapas ya tienen `_id`. Hacerlo
  // en la misma sentencia obligaría a ordenar el arreglo por profundidad y a confiar en ese orden.
  for (const { seed, parentStageCode } of flatStages) {
    const parentId = parentStageCode === null ? null : (idByCode.get(parentStageCode) ?? null);
    await queryInterface.sequelize.query(
      `UPDATE workflow_stages SET parent_stage_id = :parentId, _updated_at = NOW() WHERE _id = :stageId;`,
      { transaction, replacements: { parentId, stageId: idByCode.get(seed.stageCode) } },
    );
  }

  counters.softDeleted = await softDeleteMissing(
    queryInterface,
    'workflow_stages',
    'stage_code',
    definitionId,
    [...idByCode.keys()],
    transaction,
  );
  logCounters('etapas', counters);
  return idByCode;
}

async function upsertSteps(
  queryInterface: QueryInterface,
  definitionId: string,
  flatStages: readonly FlatStage[],
  stageIdByCode: Map<string, string>,
  transaction: Transaction,
): Promise<Map<string, string>> {
  const counters = emptyCounters();
  const idByCode = new Map<string, string>();

  for (const { seed: stage } of flatStages) {
    for (const step of stage.steps) {
      const rows = (await queryInterface.sequelize.query(
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
          workflow_stage_id = EXCLUDED.workflow_stage_id,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          endpoint_code = EXCLUDED.endpoint_code,
          http_method = EXCLUDED.http_method,
          route_path = EXCLUDED.route_path,
          execution_order = EXCLUDED.execution_order,
          is_mandatory = EXCLUDED.is_mandatory,
          is_repeatable = EXCLUDED.is_repeatable,
          requires_idempotency_key = EXCLUDED.requires_idempotency_key,
          requires_auth = EXCLUDED.requires_auth,
          is_flow_entry = EXCLUDED.is_flow_entry,
          is_flow_exit = EXCLUDED.is_flow_exit,
          allowed_roles_json = EXCLUDED.allowed_roles_json,
          required_states_json = EXCLUDED.required_states_json,
          resulting_states_json = EXCLUDED.resulting_states_json,
          input_contract_json = EXCLUDED.input_contract_json,
          output_contract_json = EXCLUDED.output_contract_json,
          validation_rules_json = EXCLUDED.validation_rules_json,
          possible_errors_json = EXCLUDED.possible_errors_json,
          retry_strategy_json = EXCLUDED.retry_strategy_json,
          produces_events_json = EXCLUDED.produces_events_json,
          consumes_events_json = EXCLUDED.consumes_events_json,
          success_criteria_json = EXCLUDED.success_criteria_json,
          failure_criteria_json = EXCLUDED.failure_criteria_json,
          _updated_at = NOW(),
          _deleted = false
        RETURNING _id, (xmax = 0) AS inserted;
        `,
        { transaction, type: QueryTypes.SELECT, replacements: stepReplacements(definitionId, stageIdByCode, stage, step) },
      )) as Array<{ _id: string; inserted: boolean }>;

      track(counters, rows);
      idByCode.set(step.stepCode, String(rows[0]._id));
    }
  }

  counters.softDeleted = await softDeleteMissing(
    queryInterface,
    'workflow_steps',
    'step_code',
    definitionId,
    [...idByCode.keys()],
    transaction,
  );
  logCounters('pasos', counters);
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
    // Derivado, nunca escrito a mano: garantiza que coincida con el catálogo técnico de endpoints.
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

async function softDeleteMissing(
  queryInterface: QueryInterface,
  table: 'workflow_stages' | 'workflow_steps',
  codeColumn: 'stage_code' | 'step_code',
  definitionId: string,
  keptCodes: readonly string[],
  transaction: Transaction,
): Promise<number> {
  const [, metadata] = await queryInterface.sequelize.query(
    `UPDATE ${table} SET _deleted = true, _updated_at = NOW()
      WHERE workflow_definition_id = :definitionId AND _deleted = false AND ${codeColumn} NOT IN (:keptCodes);`,
    { transaction, replacements: { definitionId, keptCodes: keptCodes.length > 0 ? [...keptCodes] : [''] } },
  );
  return typeof metadata === 'number' ? metadata : 0;
}

async function syncDependencies(
  queryInterface: QueryInterface,
  workflow: WorkflowSeed,
  definitionId: string,
  stepIdByCode: Map<string, string>,
  transaction: Transaction,
): Promise<void> {
  const counters = emptyCounters();
  const keptPairs: string[] = [];

  for (const dependency of workflow.dependencies) {
    const stepId = stepIdByCode.get(dependency.stepCode);
    const dependsOnStepId = stepIdByCode.get(dependency.dependsOnStepCode);
    if (!stepId || !dependsOnStepId) {
      // Una dependencia hacia un paso inexistente indicaría una definición incoherente: se corta el
      // seeding en vez de dejar el grafo a medias, porque el resto del catálogo se apoyaría en él.
      throw new Error(`Dependencia inválida: ${dependency.stepCode} -> ${dependency.dependsOnStepCode} (paso no definido).`);
    }
    const rows = (await queryInterface.sequelize.query(
      `
      INSERT INTO workflow_step_dependencies (
        workflow_definition_id, step_id, depends_on_step_id, dependency_type, description, _created_at, _updated_at
      ) VALUES (:definitionId, :stepId, :dependsOnStepId, :dependencyType, :description, NOW(), NOW())
      ON CONFLICT (step_id, depends_on_step_id) DO UPDATE SET
        dependency_type = EXCLUDED.dependency_type,
        description = EXCLUDED.description,
        _updated_at = NOW()
      RETURNING _id, (xmax = 0) AS inserted;
      `,
      {
        transaction,
        type: QueryTypes.SELECT,
        replacements: {
          definitionId,
          stepId,
          dependsOnStepId,
          dependencyType: dependency.dependencyType,
          description: dependency.description,
        },
      },
    )) as Array<{ _id: string; inserted: boolean }>;
    track(counters, rows);
    keptPairs.push(`${stepId}:${dependsOnStepId}`);
  }

  const [, removed] = await queryInterface.sequelize.query(
    `DELETE FROM workflow_step_dependencies
      WHERE workflow_definition_id = :definitionId
        AND (step_id || ':' || depends_on_step_id) NOT IN (:keptPairs);`,
    { transaction, replacements: { definitionId, keptPairs: keptPairs.length > 0 ? keptPairs : [''] } },
  );
  counters.removed = typeof removed === 'number' ? removed : 0;
  logCounters('dependencias', counters);
}

async function syncTransitions(
  queryInterface: QueryInterface,
  workflow: WorkflowSeed,
  definitionId: string,
  stepIdByCode: Map<string, string>,
  transaction: Transaction,
): Promise<void> {
  const counters = emptyCounters();
  const keptCodes: string[] = [];

  for (const transition of workflow.transitions) {
    const fromStepId = transition.fromStepCode === null ? null : stepIdByCode.get(transition.fromStepCode);
    const toStepId = transition.toStepCode === null ? null : stepIdByCode.get(transition.toStepCode);
    if (fromStepId === undefined || toStepId === undefined) {
      throw new Error(`Transición inválida ${transition.transitionCode}: referencia un paso no definido.`);
    }
    const rows = (await queryInterface.sequelize.query(
      `
      INSERT INTO workflow_transitions (
        workflow_definition_id, transition_code, from_step_id, to_step_id, condition_type,
        condition_expression_json, description, display_order, is_default_path, _created_at, _updated_at
      ) VALUES (
        :definitionId, :transitionCode, :fromStepId, :toStepId, :conditionType,
        CAST(:conditionExpression AS JSONB), :description, :displayOrder, :isDefaultPath, NOW(), NOW()
      )
      ON CONFLICT (workflow_definition_id, transition_code) DO UPDATE SET
        from_step_id = EXCLUDED.from_step_id,
        to_step_id = EXCLUDED.to_step_id,
        condition_type = EXCLUDED.condition_type,
        condition_expression_json = EXCLUDED.condition_expression_json,
        description = EXCLUDED.description,
        display_order = EXCLUDED.display_order,
        is_default_path = EXCLUDED.is_default_path,
        _updated_at = NOW()
      RETURNING _id, (xmax = 0) AS inserted;
      `,
      {
        transaction,
        type: QueryTypes.SELECT,
        replacements: {
          definitionId,
          transitionCode: transition.transitionCode,
          fromStepId: fromStepId ?? null,
          toStepId: toStepId ?? null,
          conditionType: transition.conditionType,
          conditionExpression: JSON.stringify(transition.conditionExpression ?? {}),
          description: transition.description,
          displayOrder: transition.displayOrder,
          isDefaultPath: transition.isDefaultPath ?? false,
        },
      },
    )) as Array<{ _id: string; inserted: boolean }>;
    track(counters, rows);
    keptCodes.push(transition.transitionCode);
  }

  const [, removed] = await queryInterface.sequelize.query(
    `DELETE FROM workflow_transitions WHERE workflow_definition_id = :definitionId AND transition_code NOT IN (:keptCodes);`,
    { transaction, replacements: { definitionId, keptCodes: keptCodes.length > 0 ? keptCodes : [''] } },
  );
  counters.removed = typeof removed === 'number' ? removed : 0;
  logCounters('transiciones', counters);
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const workflow = CUSTOMER_CREDIT_WORKFLOW;
  const flatStages = flattenStages(workflow.stages);

  try {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const definitionId = await upsertDefinition(queryInterface, workflow, transaction);
      const stageIdByCode = await upsertStages(queryInterface, definitionId, flatStages, transaction);
      const stepIdByCode = await upsertSteps(queryInterface, definitionId, flatStages, stageIdByCode, transaction);
      await syncDependencies(queryInterface, workflow, definitionId, stepIdByCode, transaction);
      await syncTransitions(queryInterface, workflow, definitionId, stepIdByCode, transaction);
      console.log(
        `[workflow-catalog] ${workflow.workflowCode}@${workflow.version} sembrado: ` +
          `${flatStages.length} etapas, ${stepIdByCode.size} pasos, ${workflow.dependencies.length} dependencias, ` +
          `${workflow.transitions.length} transiciones.`,
      );
    });
  } catch (error) {
    console.error(`[workflow-catalog] ERROR sembrando ${workflow.workflowCode}@${workflow.version}: ${(error as Error).message}`);
    throw error;
  }
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  // Las cinco tablas están encadenadas con ON DELETE CASCADE desde la definición: borrar la fila
  // raíz retira el árbol completo sin dejar etapas ni aristas huérfanas.
  await queryInterface.sequelize.query(`DELETE FROM workflow_definitions WHERE workflow_code = :workflowCode AND version = :version;`, {
    replacements: { workflowCode: CUSTOMER_CREDIT_WORKFLOW.workflowCode, version: CUSTOMER_CREDIT_WORKFLOW.version },
  });
}
