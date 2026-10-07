/**
 * @file Utilidad: distingue los pasos HTTP de este backend del resto de pasos del catálogo.
 * @business Esta pieza evita que el informe de consistencia y el avance del cliente traten un job o una llamada del ERP como si fuera una ruta de esta API.
 * @system el catálogo v2 admite pasos `job`, `event`, `manual` y `external`, y pasos HTTP de otros sistemas (ERP, Motor, tableros, AIService), con método y ruta nulos o ajenos a este proceso Nest.
 */
import type { WorkflowStepModel } from '../../database/models/index.js';

/** Sistema cuyas rutas monta ESTE proceso Nest: el único contra el que se puede contrastar un paso. */
export const BACKEND_SYSTEM_CODE = 'ATLAS_BACKEND';

type StepShape = Pick<WorkflowStepModel, 'httpMethod' | 'routePath'> & Partial<Pick<WorkflowStepModel, 'stepKind' | 'systemCode'>>;

/** Paso con método y ruta que expone este backend. Sin `stepKind`/`systemCode` (filas previas a v2) se asume HTTP del backend. */
export function isBackendHttpStep<T extends StepShape>(step: T): step is T & { httpMethod: string; routePath: string } {
  return (
    (step.stepKind ?? 'http') === 'http' &&
    (step.systemCode ?? BACKEND_SYSTEM_CODE) === BACKEND_SYSTEM_CODE &&
    typeof step.httpMethod === 'string' &&
    typeof step.routePath === 'string'
  );
}
