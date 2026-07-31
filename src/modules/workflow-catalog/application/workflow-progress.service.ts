/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { WorkflowProgressDto, WorkflowStageProgressDto } from '../workflow-catalog.dtos.js';
import { STANDARD_CUSTOMER_CREDIT_WORKFLOW_CODE, WorkflowProgressStatus } from '../workflow-catalog.constants.js';
import { WorkflowProgressQueryDto } from '../workflow-catalog.schemas.js';
import { WorkflowCatalogService } from '../workflow-catalog.service.js';
import { isLeafStage, stagesInTreeOrder } from '../workflow-stage-order.util.js';
import { resolveStageProgress } from './workflow-completion-rule.util.js';

/**
 * Avance de UN cliente sobre el árbol declarado.
 *
 * El catálogo aporta la estructura (qué etapas hay, en qué orden, con qué endpoints); el estado real
 * lo aporta `CustomerEligibilityService`, que ya es la única fuente de "dónde va el cliente" en todo
 * el backend. Este servicio los cruza y NO reimplementa ninguna regla de completitud: si mañana
 * cambia qué hace falta para dar por cerrada una sección, cambia en un solo sitio y aquí se refleja.
 *
 * La evaluación se hace con `evaluate` (sin persistir): consultar el avance es una lectura, y hacer
 * que cada consulta del frontend escribiera una fila de evidencia convertiría la tabla de
 * evaluaciones en un log de polling en vez de un registro de decisiones.
 */
@Injectable()
export class WorkflowProgressService {
  constructor(
    private readonly catalogService: WorkflowCatalogService,
    private readonly eligibilityService: CustomerEligibilityService,
  ) {}

  async getProgress(input: {
    tenantId: string;
    customerId: string;
    currentUser: AuthenticatedUser;
    query: WorkflowProgressQueryDto;
  }): Promise<WorkflowProgressDto> {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const workflowCode = input.query.workflowCode ?? STANDARD_CUSTOMER_CREDIT_WORKFLOW_CODE;
    const [bundle, assessment] = await Promise.all([
      this.catalogService.loadBundle(workflowCode, input.query.version),
      this.eligibilityService.evaluate(input.tenantId, input.customerId),
    ]);

    const stagesInOrder = stagesInTreeOrder(bundle.stages);
    const stageStatuses = new Map<string, { status: WorkflowProgressStatus; reason: string | null }>();
    for (const stage of stagesInOrder) {
      stageStatuses.set(stage.stageCode, resolveStageProgress(stage.completionRule ?? {}, assessment));
    }

    /**
     * La etapa "actual" es la primera HOJA pendiente en orden de recorrido del árbol.
     *
     * Hoja, porque una etapa contenedora (la captura de datos, por ejemplo) está pendiente por
     * definición mientras alguna de sus subetapas lo esté: señalarla como el foco mandaría al
     * cliente a un contenedor en vez de a la acción concreta que le toca.
     */
    const currentStageCode =
      stagesInOrder.find((stage) => stageStatuses.get(stage.stageCode)?.status === 'pending' && isLeafStage(stage, bundle.stages))
        ?.stageCode ?? null;
    if (currentStageCode) {
      const entry = stageStatuses.get(currentStageCode);
      if (entry) stageStatuses.set(currentStageCode, { ...entry, status: 'current' });
    }

    const stepsByStage = new Map<string, typeof bundle.steps>();
    for (const step of [...bundle.steps].sort((a, b) => a.executionOrder - b.executionOrder)) {
      stepsByStage.set(String(step.workflowStageId), [...(stepsByStage.get(String(step.workflowStageId)) ?? []), step]);
    }

    const stages: WorkflowStageProgressDto[] = stagesInOrder.map((stage) => {
      const resolved = stageStatuses.get(stage.stageCode) ?? { status: 'pending' as WorkflowProgressStatus, reason: null };
      return {
        stageCode: stage.stageCode,
        name: stage.name,
        moduleCode: stage.moduleCode,
        actorType: stage.actorType,
        displayOrder: stage.displayOrder,
        isOptional: stage.isOptional,
        status: resolved.status,
        reason: resolved.reason,
        steps: (stepsByStage.get(String(stage.id)) ?? []).map((step) => ({
          stepCode: step.stepCode,
          httpMethod: step.httpMethod,
          routePath: step.routePath,
          isMandatory: step.isMandatory,
          // El estado de un paso hereda el de su etapa: el backend registra el resultado del proceso
          // (sección completa, estado alcanzado), no cada llamada HTTP individual. Inventar un
          // estado por paso exigiría un log de ejecución que no existe — y fingirlo sería peor.
          status: resolved.status,
        })),
      };
    });

    const nextStep = this.resolveNextStep(bundle, currentStageCode);

    return {
      workflowCode: bundle.definition.workflowCode,
      version: bundle.definition.version,
      customerId: input.customerId,
      lifecycleStatus: assessment.lifecycleStatus,
      eligible: assessment.eligible,
      completionPercentage: assessment.completionPercentage,
      currentStageCode,
      nextStep,
      completedStageCodes: codesWithStatus(stages, 'completed'),
      // Incluye la etapa actual y conserva el orden de recorrido: es la lista de "lo que falta",
      // y sacar la actual de su lugar obligaría al consumidor a reinsertarla para pintarla.
      pendingStageCodes: codesWithStatus(stages, 'current', 'pending'),
      blockedStageCodes: codesWithStatus(stages, 'blocked'),
      blockers: assessment.blockers,
      stages,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /** Primer paso obligatorio de la etapa actual: la llamada concreta que el cliente debe hacer ahora. */
  private resolveNextStep(
    bundle: Awaited<ReturnType<WorkflowCatalogService['loadBundle']>>,
    currentStageCode: string | null,
  ): WorkflowProgressDto['nextStep'] {
    if (!currentStageCode) return null;
    const stage = bundle.stages.find((candidate) => candidate.stageCode === currentStageCode);
    if (!stage) return null;
    const step = bundle.steps
      .filter((candidate) => String(candidate.workflowStageId) === String(stage.id) && candidate.isMandatory)
      .sort((a, b) => a.executionOrder - b.executionOrder)[0];
    if (!step) return null;
    return {
      stageCode: stage.stageCode,
      stepCode: step.stepCode,
      httpMethod: step.httpMethod,
      routePath: step.routePath,
      allowedRoles: step.allowedRoles ?? [],
    };
  }
}

function codesWithStatus(stages: WorkflowStageProgressDto[], ...statuses: WorkflowProgressStatus[]): string[] {
  return stages.filter((stage) => statuses.includes(stage.status)).map((stage) => stage.stageCode);
}
