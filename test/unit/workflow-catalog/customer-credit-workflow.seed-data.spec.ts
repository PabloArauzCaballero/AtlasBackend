import { beforeAll, describe, expect, it } from '@jest/globals';
import { ELIGIBILITY_BLOCKER_CODES, ONBOARDING_SECTION_CODES } from '../../../src/modules/customers/customer-eligibility.constants.js';
import { CUSTOMER_LIFECYCLE_STATUSES } from '../../../src/modules/customers/customer-lifecycle.constants.js';
import { EndpointDiscoveryService } from '../../../src/modules/systems-ops/endpoint-discovery.service.js';
import { buildEndpointCode, normalizeEndpointPath } from '../../../src/modules/systems-ops/endpoint-code.util.js';
import {
  CUSTOMER_CREDIT_WORKFLOW,
  WorkflowStageSeed,
  WorkflowStepSeed,
} from '../../../src/database/seed-data/customer-credit-workflow.seed-data.js';
import {
  WORKFLOW_ACTOR_TYPES,
  WORKFLOW_COMPLETION_RULE_TYPES,
  WORKFLOW_CONDITION_TYPES,
  WORKFLOW_DEPENDENCY_TYPES,
  WORKFLOW_HTTP_METHODS,
  WORKFLOW_PROCESS_TYPES,
  WORKFLOW_STATUSES,
  STANDARD_CUSTOMER_CREDIT_WORKFLOW_CODE,
} from '../../../src/modules/workflow-catalog/workflow-catalog.constants.js';
import type { AtlasUserRole } from '../../../src/common/types/auth.types.js';

/**
 * El árbol sembrado NO puede inventar endpoints, roles ni estados.
 *
 * Este spec es la red que lo garantiza sin base de datos: cruza la definición contra las fuentes de
 * verdad reales del repositorio —los controladores (vía el mismo escáner que usa `systems-ops`), la
 * máquina de estados del cliente y los códigos de la regla de habilitación— y falla si el catálogo
 * se desincroniza. Es el complemento estático del informe de consistencia en runtime.
 */

const ROLES: readonly AtlasUserRole[] = [
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'system',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
  'merchant',
  'admin',
  'platform_admin',
];

function flatten(stages: readonly WorkflowStageSeed[]): WorkflowStageSeed[] {
  return stages.flatMap((stage) => [stage, ...flatten(stage.subStages ?? [])]);
}

const ALL_STAGES = flatten(CUSTOMER_CREDIT_WORKFLOW.stages);
const ALL_STEPS: WorkflowStepSeed[] = ALL_STAGES.flatMap((stage) => stage.steps);

describe('CUSTOMER_CREDIT_WORKFLOW — coherencia estructural', () => {
  it('declara el código del flujo estándar que consume el módulo', () => {
    expect(CUSTOMER_CREDIT_WORKFLOW.workflowCode).toBe(STANDARD_CUSTOMER_CREDIT_WORKFLOW_CODE);
    expect(WORKFLOW_STATUSES).toContain(CUSTOMER_CREDIT_WORKFLOW.status);
    expect(WORKFLOW_PROCESS_TYPES).toContain(CUSTOMER_CREDIT_WORKFLOW.processType as never);
  });

  it('no repite códigos de etapa ni de paso', () => {
    const stageCodes = ALL_STAGES.map((stage) => stage.stageCode);
    const stepCodes = ALL_STEPS.map((step) => step.stepCode);
    expect(new Set(stageCodes).size).toBe(stageCodes.length);
    expect(new Set(stepCodes).size).toBe(stepCodes.length);
  });

  it('no repite códigos de transición', () => {
    const codes = CUSTOMER_CREDIT_WORKFLOW.transitions.map((transition) => transition.transitionCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('la etapa de entrada y las terminales existen y están marcadas como tales', () => {
    const entry = ALL_STAGES.find((stage) => stage.stageCode === CUSTOMER_CREDIT_WORKFLOW.entryStageCode);
    expect(entry?.isEntryStage).toBe(true);
    for (const code of CUSTOMER_CREDIT_WORKFLOW.terminalStageCodes) {
      expect(ALL_STAGES.find((stage) => stage.stageCode === code)?.isTerminalStage).toBe(true);
    }
  });

  it('usa solo tipos de actor, método HTTP y condición del vocabulario cerrado', () => {
    for (const stage of ALL_STAGES) expect(WORKFLOW_ACTOR_TYPES).toContain(stage.actorType);
    for (const step of ALL_STEPS) expect(WORKFLOW_HTTP_METHODS).toContain(step.httpMethod);
    for (const transition of CUSTOMER_CREDIT_WORKFLOW.transitions) {
      expect(WORKFLOW_CONDITION_TYPES).toContain(transition.conditionType);
    }
    for (const dependency of CUSTOMER_CREDIT_WORKFLOW.dependencies) {
      expect(WORKFLOW_DEPENDENCY_TYPES).toContain(dependency.dependencyType);
    }
  });

  it('todas las rutas empiezan con barra y ningún paso repite orden dentro de su etapa', () => {
    for (const step of ALL_STEPS) expect(step.routePath.startsWith('/')).toBe(true);
    for (const stage of ALL_STAGES) {
      const orders = stage.steps.map((step) => step.executionOrder);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it('dependencias y transiciones solo referencian pasos definidos', () => {
    const stepCodes = new Set(ALL_STEPS.map((step) => step.stepCode));
    for (const dependency of CUSTOMER_CREDIT_WORKFLOW.dependencies) {
      expect(stepCodes.has(dependency.stepCode)).toBe(true);
      expect(stepCodes.has(dependency.dependsOnStepCode)).toBe(true);
      expect(dependency.stepCode).not.toBe(dependency.dependsOnStepCode);
    }
    for (const transition of CUSTOMER_CREDIT_WORKFLOW.transitions) {
      if (transition.fromStepCode !== null) expect(stepCodes.has(transition.fromStepCode)).toBe(true);
      if (transition.toStepCode !== null) expect(stepCodes.has(transition.toStepCode)).toBe(true);
      expect(transition.fromStepCode !== null || transition.toStepCode !== null).toBe(true);
    }
  });

  it('el grafo de dependencias obligatorias no tiene ciclos', () => {
    const edges = new Map<string, string[]>();
    for (const dependency of CUSTOMER_CREDIT_WORKFLOW.dependencies) {
      edges.set(dependency.stepCode, [...(edges.get(dependency.stepCode) ?? []), dependency.dependsOnStepCode]);
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const walk = (code: string): void => {
      if (done.has(code)) return;
      if (visiting.has(code)) throw new Error(`Ciclo de dependencias detectado en ${code}`);
      visiting.add(code);
      for (const next of edges.get(code) ?? []) walk(next);
      visiting.delete(code);
      done.add(code);
    };
    expect(() => [...edges.keys()].forEach(walk)).not.toThrow();
  });

  it('declara exactamente una entrada y una salida de flujo', () => {
    expect(ALL_STEPS.filter((step) => step.isFlowEntry)).toHaveLength(1);
    expect(ALL_STEPS.filter((step) => step.isFlowExit)).toHaveLength(1);
    expect(CUSTOMER_CREDIT_WORKFLOW.transitions.filter((transition) => transition.fromStepCode === null)).toHaveLength(1);
    expect(CUSTOMER_CREDIT_WORKFLOW.transitions.filter((transition) => transition.toStepCode === null)).toHaveLength(1);
  });
});

describe('CUSTOMER_CREDIT_WORKFLOW — coherencia con el dominio', () => {
  it('solo usa roles del sistema de autorización', () => {
    for (const step of ALL_STEPS) {
      for (const role of step.allowedRoles) expect(ROLES).toContain(role as AtlasUserRole);
    }
    for (const stage of ALL_STAGES) {
      for (const role of stage.allowedRoles ?? []) expect(ROLES).toContain(role as AtlasUserRole);
    }
  });

  it('solo usa estados de la máquina de estados del cliente', () => {
    const valid = new Set<string>(CUSTOMER_LIFECYCLE_STATUSES);
    for (const stage of ALL_STAGES) {
      for (const state of [...(stage.requiredStates ?? []), ...(stage.resultingStates ?? [])]) expect(valid.has(state)).toBe(true);
    }
    for (const step of ALL_STEPS) {
      for (const state of [...(step.requiredStates ?? []), ...(step.resultingStates ?? [])]) expect(valid.has(state)).toBe(true);
    }
  });

  it('las reglas de completitud nombran secciones, estados y bloqueadores que existen', () => {
    const sections = new Set<string>(ONBOARDING_SECTION_CODES);
    const blockers = new Set<string>(ELIGIBILITY_BLOCKER_CODES);
    const statuses = new Set<string>(CUSTOMER_LIFECYCLE_STATUSES);

    for (const stage of ALL_STAGES) {
      const rule = stage.completionRule as { type?: string; sectionCode?: string; statuses?: string[]; blockerCodes?: string[] };
      expect(WORKFLOW_COMPLETION_RULE_TYPES).toContain(rule.type as never);
      if (rule.type === 'onboarding_section') expect(sections.has(String(rule.sectionCode))).toBe(true);
      if (rule.type === 'lifecycle_status') for (const status of rule.statuses ?? []) expect(statuses.has(status)).toBe(true);
      if (rule.type === 'no_blockers') for (const code of rule.blockerCodes ?? []) expect(blockers.has(code)).toBe(true);
    }
  });

  it('cubre las seis secciones del onboarding con una etapa cada una', () => {
    const covered = ALL_STAGES.map((stage) => (stage.completionRule as { sectionCode?: string }).sectionCode).filter(Boolean);
    expect([...covered].sort()).toEqual([...ONBOARDING_SECTION_CODES].sort());
  });
});

describe('CUSTOMER_CREDIT_WORKFLOW — coherencia con los endpoints reales', () => {
  let exposed: Map<string, { requiresAuth?: boolean }>;

  beforeAll(async () => {
    // Mismo escáner de controladores que usa `systems-ops`: la fuente de verdad de qué rutas
    // declara el repositorio. Se le pasa un clasificador mínimo porque solo interesan método y ruta.
    const classifier = { riskLevelForEndpoint: () => 'LOW', containsPiiForEndpoint: () => false };
    const discovered = await new EndpointDiscoveryService({} as never, classifier as never, {} as never).scanControllers();
    exposed = new Map(discovered.map((item) => [`${item.method} /${normalizeEndpointPath(item.fullPath)}`, item]));
  }, 60_000);

  it('cada paso apunta a un endpoint declarado en un controlador real', () => {
    const missing = ALL_STEPS.filter((step) => !exposed.has(`${step.httpMethod} ${step.routePath}`)).map(
      (step) => `${step.stepCode} -> ${step.httpMethod} ${step.routePath}`,
    );
    expect(missing).toEqual([]);
  });

  it('el paso marcado como público coincide con un endpoint sin autenticación', () => {
    for (const step of ALL_STEPS.filter((candidate) => candidate.requiresAuth === false)) {
      expect(exposed.get(`${step.httpMethod} ${step.routePath}`)?.requiresAuth).toBe(false);
    }
  });

  it('el código de endpoint derivado es estable y único por paso', () => {
    const codes = ALL_STEPS.map((step) => buildEndpointCode(step.httpMethod, step.routePath));
    expect(new Set(codes).size).toBe(codes.length);
    expect(buildEndpointCode('POST', '/customer-onboarding/:customerId/submit')).toBe('POST_CUSTOMER_ONBOARDING_BY_CUSTOMERID_SUBMIT');
  });
});
