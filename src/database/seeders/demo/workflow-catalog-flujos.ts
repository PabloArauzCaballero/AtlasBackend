/**
 * @file Contratos de la siembra demostrativa del repositorio.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { refA, type BloqueSembrado, type FilaSembrada } from './tipos.js';

/**
 * Constructor de un flujo documentado a partir de su ÁRBOL, no de cuatro listas paralelas.
 *
 * Las filas del catálogo viven en cuatro tablas —definición, etapas, pasos y dependencias— y cada
 * fila hija repite la referencia natural a su padre. Escritas a mano, un flujo de veinte etapas son
 * miles de líneas donde el noventa por ciento es la misma referencia copiada, y basta un
 * `stage_code` mal tecleado para que la siembra falle con un mensaje que no dice cuál.
 *
 * Aquí el flujo se declara como se piensa —etapas, y dentro cada paso— y esta función deriva lo
 * demás: el orden de ejecución por posición, la dependencia de cada paso con el anterior de su
 * etapa, y las referencias cruzadas. Lo que se revisa en el diff es el ÁRBOL.
 */

type PasoDeclarado = {
  code: string;
  name: string;
  description: string;
  method: string;
  path: string;
  /** Actor que ejecuta ESTE paso. Un recorrido real mezcla cliente, operador y comercio. */
  roles?: string[];
  auth?: boolean;
  optional?: boolean;
  repeatable?: boolean;
  idempotencyKey?: boolean;
  requiredStates?: string[];
  resultingStates?: string[];
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errors?: string[];
  events?: string[];
  successStatus?: number[];
};

type EtapaDeclarada = {
  code: string;
  name: string;
  description: string;
  module: string;
  actor: 'customer' | 'internal_user' | 'merchant_user' | 'system';
  optional?: boolean;
  entry?: boolean;
  terminal?: boolean;
  roles?: string[];
  requiredStates?: string[];
  resultingStates?: string[];
  steps: PasoDeclarado[];
};

type FlujoDeclarado = {
  code: string;
  version: string;
  name: string;
  description: string;
  processType: string;
  ownerDomain: string;
  success: string;
  failure: string;
  metadata?: Record<string, unknown>;
  stages: EtapaDeclarada[];
};

const SELLO = '2026-09-21T00:00:00.000+00:00';

/** El mismo algoritmo que `buildEndpointCode`, para que los dos catálogos crucen por construcción. */
function endpointCode(method: string, path: string): string {
  const normalizado = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/:([A-Za-z0-9_]+)/g, 'by_$1')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
  return `${method.toUpperCase()}_${normalizado || 'ROOT'}`.slice(0, 180);
}

function refFlujo(flujo: FlujoDeclarado) {
  return refA('platform_ops.workflow_definitions', { workflow_code: flujo.code, version: flujo.version });
}

function refEtapa(flujo: FlujoDeclarado, stageCode: string) {
  return refA('platform_ops.workflow_stages', { workflow_definition_id: refFlujo(flujo), stage_code: stageCode });
}

function refPaso(flujo: FlujoDeclarado, stepCode: string) {
  return refA('platform_ops.workflow_steps', { workflow_definition_id: refFlujo(flujo), step_code: stepCode });
}

function filaDefinicion(flujo: FlujoDeclarado): FilaSembrada {
  const entrada = flujo.stages.find((etapa) => etapa.entry);
  return {
    workflow_code: flujo.code,
    version: flujo.version,
    name: flujo.name,
    description: flujo.description,
    process_type: flujo.processType,
    owner_domain: flujo.ownerDomain,
    status: 'active',
    is_default: true,
    entry_stage_code: entrada?.code ?? flujo.stages[0]?.code ?? null,
    terminal_stage_codes: flujo.stages.filter((etapa) => etapa.terminal).map((etapa) => etapa.code),
    success_criteria_json: { description: flujo.success },
    failure_criteria_json: { description: flujo.failure },
    metadata_json: { documentation: 'docs/endpoints/workflow-catalog.md', ...(flujo.metadata ?? {}) },
    source: 'seed',
    effective_from: null,
    effective_until: null,
    created_by: 'seed:20260921-flujos-completos',
    updated_by: 'seed:20260921-flujos-completos',
    _created_at: SELLO,
    _updated_at: SELLO,
    _deleted: false,
  };
}

function filasEtapas(flujo: FlujoDeclarado): FilaSembrada[] {
  return flujo.stages.map((etapa, indice) => ({
    workflow_definition_id: refFlujo(flujo),
    parent_stage_id: null,
    stage_code: etapa.code,
    name: etapa.name,
    description: etapa.description,
    module_code: etapa.module,
    actor_type: etapa.actor,
    display_order: (indice + 1) * 10,
    is_optional: etapa.optional ?? false,
    is_entry_stage: etapa.entry ?? false,
    is_terminal_stage: etapa.terminal ?? false,
    allowed_roles_json: etapa.roles ?? [],
    required_states_json: etapa.requiredStates ?? [],
    resulting_states_json: etapa.resultingStates ?? [],
    completion_rule_json: { type: 'manual' },
    metadata_json: {},
    _created_at: SELLO,
    _updated_at: SELLO,
    _deleted: false,
  }));
}

function filasPasos(flujo: FlujoDeclarado): FilaSembrada[] {
  const filas: FilaSembrada[] = [];
  flujo.stages.forEach((etapa, indiceEtapa) => {
    etapa.steps.forEach((paso, indicePaso) => {
      filas.push({
        workflow_definition_id: refFlujo(flujo),
        workflow_stage_id: refEtapa(flujo, etapa.code),
        step_code: paso.code,
        name: paso.name,
        description: paso.description,
        endpoint_code: endpointCode(paso.method, paso.path),
        http_method: paso.method,
        route_path: paso.path,
        // El orden global se deriva de la posición: la etapa manda sobre el paso, y dentro de la
        // etapa manda el orden de escritura. Sin esto, dos pasos de etapas distintas podían
        // compartir `execution_order` y el recorrido dejaba de tener un orden reproducible.
        execution_order: (indiceEtapa + 1) * 100 + (indicePaso + 1) * 10,
        is_mandatory: !(paso.optional ?? false),
        is_repeatable: paso.repeatable ?? false,
        requires_idempotency_key: paso.idempotencyKey ?? false,
        requires_auth: paso.auth ?? true,
        is_flow_entry: indiceEtapa === 0 && indicePaso === 0,
        is_flow_exit: indiceEtapa === flujo.stages.length - 1 && indicePaso === etapa.steps.length - 1,
        allowed_roles_json: paso.roles ?? etapa.roles ?? [],
        required_states_json: paso.requiredStates ?? [],
        resulting_states_json: paso.resultingStates ?? [],
        input_contract_json: paso.input ?? {},
        output_contract_json: paso.output ?? {},
        validation_rules_json: [],
        possible_errors_json: paso.errors ?? [],
        retry_strategy_json: paso.idempotencyKey
          ? { strategy: 'client_retry_with_idempotency_key', maxAttempts: 3, backoff: 'exponential' }
          : {},
        produces_events_json: paso.events ?? [],
        consumes_events_json: [],
        success_criteria_json: { statusCodes: paso.successStatus ?? [200] },
        failure_criteria_json: {},
        metadata_json: {},
        _created_at: SELLO,
        _updated_at: SELLO,
        _deleted: false,
      });
    });
  });
  return filas;
}

/**
 * Dependencias derivadas: cada paso depende del anterior de su etapa, y el primero de cada etapa
 * del último de la etapa previa.
 *
 * Es la precedencia REAL del recorrido, no una decoración: es lo que permite que un motor de QA
 * omita a los dependientes de un paso que falló en vez de lanzar peticiones condenadas y llenar el
 * informe de ruido derivado.
 */
function filasDependencias(flujo: FlujoDeclarado): FilaSembrada[] {
  const filas: FilaSembrada[] = [];
  let anterior: PasoDeclarado | null = null;
  for (const etapa of flujo.stages) {
    for (const paso of etapa.steps) {
      if (anterior) {
        filas.push({
          workflow_definition_id: refFlujo(flujo),
          step_id: refPaso(flujo, paso.code),
          depends_on_step_id: refPaso(flujo, anterior.code),
          dependency_type: paso.optional ? 'soft' : 'requires_completion',
          description: `${paso.code} necesita que ${anterior.code} haya terminado.`,
          _created_at: SELLO,
          _updated_at: SELLO,
        });
      }
      anterior = paso;
    }
  }
  return filas;
}

export function bloquesDeFlujos(flujos: readonly FlujoDeclarado[]): BloqueSembrado[] {
  return [
    {
      tabla: 'platform_ops.workflow_definitions',
      conflicto: ['workflow_code', 'version'],
      filas: flujos.map(filaDefinicion),
    },
    {
      tabla: 'platform_ops.workflow_stages',
      conflicto: ['workflow_definition_id', 'stage_code'],
      filas: flujos.flatMap(filasEtapas),
    },
    {
      tabla: 'platform_ops.workflow_steps',
      conflicto: ['workflow_definition_id', 'step_code'],
      filas: flujos.flatMap(filasPasos),
    },
    {
      tabla: 'platform_ops.workflow_step_dependencies',
      conflicto: ['step_id', 'depends_on_step_id'],
      filas: flujos.flatMap(filasDependencias),
    },
  ];
}

export type { FlujoDeclarado, EtapaDeclarada, PasoDeclarado };
