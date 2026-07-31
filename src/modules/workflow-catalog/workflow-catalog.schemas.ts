/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { z } from 'zod';
import { WORKFLOW_PROCESS_TYPES, WORKFLOW_STATUSES } from './workflow-catalog.constants.js';

/**
 * `version` acepta la etiqueta literal `latest` además de una versión concreta.
 *
 * Sin ella, un consumidor que solo quiere "el flujo vigente" tendría que hacer dos llamadas (listar
 * versiones y luego pedir una), y quedaría acoplado a un número que cambia con cada publicación.
 */
export const WORKFLOW_LATEST_VERSION = 'latest';

const workflowCode = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, 'workflowCode debe ser snake_case en minúsculas.');

const versionLabel = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^(latest|v[0-9]+(?:\.[0-9]+)?)$/, 'version debe ser "latest" o de la forma v1 / v1.2.');

export const workflowCodeParamsSchema = z.object({ workflowCode });
export type WorkflowCodeParamsDto = z.infer<typeof workflowCodeParamsSchema>;

export const listWorkflowsQuerySchema = z.object({
  status: z.enum(WORKFLOW_STATUSES).optional(),
  processType: z.enum(WORKFLOW_PROCESS_TYPES).optional(),
  ownerDomain: z.string().trim().min(1).max(80).optional(),
  /** Devuelve solo los flujos que contengan al menos una etapa de este módulo funcional. */
  moduleCode: z.string().trim().min(1).max(80).optional(),
  /** Devuelve solo los flujos con al menos un paso autorizado para este rol. */
  role: z.string().trim().min(1).max(60).optional(),
  includeDeprecated: z.coerce.boolean().default(false),
});
export type ListWorkflowsQueryDto = z.infer<typeof listWorkflowsQuerySchema>;

export const workflowVersionQuerySchema = z.object({
  version: versionLabel.default(WORKFLOW_LATEST_VERSION),
});
export type WorkflowVersionQueryDto = z.infer<typeof workflowVersionQuerySchema>;

export const workflowTreeQuerySchema = workflowVersionQuerySchema.extend({
  /** Filtra etapas por módulo funcional; las etapas padre se conservan para no romper el árbol. */
  moduleCode: z.string().trim().min(1).max(80).optional(),
  /** Filtra pasos por rol autorizado. Una etapa sin pasos visibles se omite. */
  role: z.string().trim().min(1).max(60).optional(),
  /** Filtra etapas cuyos `requiredStates` incluyan este estado del ciclo de vida. */
  lifecycleStatus: z.string().trim().min(1).max(40).optional(),
  actorType: z.string().trim().min(1).max(40).optional(),
});
export type WorkflowTreeQueryDto = z.infer<typeof workflowTreeQuerySchema>;

export const workflowProgressQuerySchema = z.object({
  workflowCode: workflowCode.optional(),
  version: versionLabel.default(WORKFLOW_LATEST_VERSION),
});
export type WorkflowProgressQueryDto = z.infer<typeof workflowProgressQuerySchema>;

/**
 * Petición de validación de transición.
 *
 * `fromStepCode` ausente significa "¿puedo ENTRAR al flujo por este paso?", que es una pregunta
 * distinta de "¿puedo pasar de A a B?" y hay que poder hacerla sin inventar un origen falso.
 */
export const validateWorkflowTransitionSchema = z.object({
  version: versionLabel.default(WORKFLOW_LATEST_VERSION),
  fromStepCode: z.string().trim().min(1).max(120).optional(),
  toStepCode: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(60).optional(),
  lifecycleStatus: z.string().trim().min(1).max(40).optional(),
  completedStepCodes: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
});
export type ValidateWorkflowTransitionDto = z.infer<typeof validateWorkflowTransitionSchema>;
