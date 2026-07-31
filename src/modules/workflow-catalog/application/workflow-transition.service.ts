/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Injectable } from '@nestjs/common';
import { WorkflowTransitionCheckDto } from '../workflow-catalog.dtos.js';
import { ValidateWorkflowTransitionDto } from '../workflow-catalog.schemas.js';
import { WorkflowBundle } from '../workflow-catalog.repository.js';
import { WorkflowCatalogService } from '../workflow-catalog.service.js';
import { toWorkflowTransition } from '../workflow-catalog.mapper.js';

type Step = WorkflowBundle['steps'][number];
type Transition = WorkflowBundle['transitions'][number];
type Rejection = Pick<WorkflowTransitionCheckDto, 'reasonCode' | 'message'> & { unsatisfiedDependencies?: string[] };

/**
 * ¿Es legal ir de un paso al siguiente en este flujo?
 *
 * IMPORTANTE sobre el alcance: esto valida el GRAFO DECLARADO, no autoriza la petición real. La
 * autorización efectiva la siguen imponiendo los guards y las reglas de cada servicio en el momento
 * de ejecutar el endpoint. Sirve para que un cliente HTTP sepa por adelantado qué puede intentar sin
 * tener que descubrirlo a base de 403 y 422 — y para que el portal interno explique por qué un paso
 * está cerrado. Si esta comprobación y el servicio real discreparan, manda el servicio real; el
 * informe de consistencia existe precisamente para que esa discrepancia sea visible.
 */
@Injectable()
export class WorkflowTransitionService {
  constructor(private readonly catalogService: WorkflowCatalogService) {}

  async validate(workflowCode: string, body: ValidateWorkflowTransitionDto): Promise<WorkflowTransitionCheckDto> {
    const bundle = await this.catalogService.loadBundle(workflowCode, body.version);
    const stepByCode = new Map(bundle.steps.map((step) => [step.stepCode, step]));
    const stepCodeById = new Map(bundle.steps.map((step) => [String(step.id), step.stepCode]));

    const base: Omit<WorkflowTransitionCheckDto, 'allowed' | 'reasonCode' | 'message'> = {
      workflowCode: bundle.definition.workflowCode,
      version: bundle.definition.version,
      fromStepCode: body.fromStepCode ?? null,
      toStepCode: body.toStepCode,
      transition: null,
      unsatisfiedDependencies: [],
      requiredStates: [],
      allowedRoles: [],
    };

    const target = stepByCode.get(body.toStepCode);
    if (!target || (body.fromStepCode !== undefined && !stepByCode.has(body.fromStepCode))) {
      return {
        ...base,
        allowed: false,
        reasonCode: 'STEP_NOT_FOUND',
        message: 'Alguno de los pasos indicados no existe en esta versión del flujo.',
      };
    }

    const context = { ...base, requiredStates: target.requiredStates ?? [], allowedRoles: target.allowedRoles ?? [] };
    const transition = findTransition(bundle, stepByCode, target, body.fromStepCode);
    if (!transition) {
      return { ...context, allowed: false, ...notDeclared(body) };
    }

    const withTransition = { ...context, transition: toWorkflowTransition(transition, stepCodeById) };
    const rejection = rejectionFor(bundle, stepCodeById, target, body);
    if (rejection) {
      const { unsatisfiedDependencies, ...reason } = rejection;
      return { ...withTransition, allowed: false, ...reason, unsatisfiedDependencies: unsatisfiedDependencies ?? [] };
    }

    return {
      ...withTransition,
      allowed: true,
      reasonCode: 'TRANSITION_DECLARED',
      message: 'La transición está declarada y se cumplen sus precondiciones conocidas.',
    };
  }
}

function findTransition(
  bundle: WorkflowBundle,
  stepByCode: Map<string, Step>,
  target: Step,
  fromStepCode: string | undefined,
): Transition | undefined {
  const fromStepId = fromStepCode === undefined ? null : String(stepByCode.get(fromStepCode)?.id);
  return bundle.transitions.find(
    (candidate) =>
      String(candidate.toStepId ?? '') === String(target.id) &&
      (fromStepId === null ? candidate.fromStepId === null : String(candidate.fromStepId ?? '') === fromStepId),
  );
}

function notDeclared(body: ValidateWorkflowTransitionDto): Rejection {
  return {
    reasonCode: 'TRANSITION_NOT_DECLARED',
    message:
      body.fromStepCode === undefined
        ? `El paso ${body.toStepCode} no es una entrada declarada del flujo.`
        : `No hay transición declarada de ${body.fromStepCode} a ${body.toStepCode}.`,
  };
}

/**
 * Primera precondición incumplida, en orden de generalidad: faltar un paso previo obligatorio es un
 * impedimento más básico que el rol o el estado, y reportarlo primero evita mandar al consumidor a
 * resolver un permiso cuando en realidad le falta recorrido.
 */
function rejectionFor(
  bundle: WorkflowBundle,
  stepCodeById: Map<string, string>,
  target: Step,
  body: ValidateWorkflowTransitionDto,
): Rejection | null {
  const unsatisfied = unsatisfiedDependencies(bundle, stepCodeById, target, body.completedStepCodes);
  if (unsatisfied.length > 0) {
    return {
      reasonCode: 'UNSATISFIED_DEPENDENCIES',
      unsatisfiedDependencies: unsatisfied,
      message: `Faltan pasos previos obligatorios: ${unsatisfied.join(', ')}.`,
    };
  }

  const allowedRoles = target.allowedRoles ?? [];
  if (body.role && allowedRoles.length > 0 && !allowedRoles.includes(body.role)) {
    return { reasonCode: 'ROLE_NOT_AUTHORIZED', message: `El rol ${body.role} no está autorizado en ${body.toStepCode}.` };
  }

  const requiredStates = target.requiredStates ?? [];
  if (body.lifecycleStatus && requiredStates.length > 0 && !requiredStates.includes(body.lifecycleStatus)) {
    return {
      reasonCode: 'STATE_NOT_ALLOWED',
      message: `El paso ${body.toStepCode} requiere que el cliente esté en ${requiredStates.join(' | ')}, no en ${body.lifecycleStatus}.`,
    };
  }

  return null;
}

/**
 * Las dependencias son un AND duro solo cuando son `requires_completion`: describen un paso sin el
 * cual el siguiente no puede ejecutarse. `requires_data` y `soft` informan al consumidor pero no
 * bloquean — frenar un recorrido legítimo por una recomendación sería peor que no declararla.
 */
function unsatisfiedDependencies(
  bundle: WorkflowBundle,
  stepCodeById: Map<string, string>,
  target: Step,
  completedStepCodes: readonly string[],
): string[] {
  const completed = new Set(completedStepCodes);
  return bundle.dependencies
    .filter((dependency) => String(dependency.stepId) === String(target.id) && dependency.dependencyType === 'requires_completion')
    .map((dependency) => stepCodeById.get(String(dependency.dependsOnStepId)) ?? '')
    .filter((code) => code !== '' && !completed.has(code));
}
