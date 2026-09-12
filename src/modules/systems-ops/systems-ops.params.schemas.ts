/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system valida los parámetros de ruta de systems-ops antes de que lleguen al caso de uso.
 */
import { z } from 'zod';

/**
 * Los parámetros de RUTA de systems-ops, separados de `systems-ops.schemas.ts`.
 *
 * Salieron de allí porque aquel archivo ya estaba en la deuda congelada de tamaño y el trinquete no
 * deja que empeore: añadir el bloque del ecosistema lo habría empujado por encima. Este corte es el
 * natural — un identificador de ruta se valida siempre igual y no comparte nada con los cuerpos de
 * petición, que son los que crecen cada vez que se añade un caso de uso.
 *
 * `systems-ops.schemas.ts` los reexporta, así que ningún consumidor tiene que enterarse de la
 * mudanza.
 */
const positiveId = z.string().regex(/^[1-9][0-9]*$/);

export const systemsEndpointParamsSchema = z.object({ endpointId: positiveId });
export const systemsToolParamsSchema = z.object({ toolId: positiveId });
export const systemsEntityParamsSchema = z.object({ entityId: positiveId });
export const systemsTableImpactParamsSchema = z.object({
  schemaName: z.string().trim().min(1).max(120),
  tableName: z.string().trim().min(1).max(180),
});
export const systemsSuiteParamsSchema = z.object({ suiteId: positiveId });
export const systemsRunParamsSchema = z.object({ runId: positiveId });
export const systemsDataImpactParamsSchema = z.object({ impactId: positiveId });
export const systemsFieldImpactParamsSchema = z.object({ fieldImpactId: positiveId });
export const systemsDomainParamsSchema = z.object({
  domainCode: z.string().trim().min(1).max(120),
});
export const systemsToolRequirementParamsSchema = z.object({ requirementId: positiveId });
export const systemsStressProfileParamsSchema = z.object({ profileId: positiveId });
export const systemsRequestParamsSchema = z.object({ requestId: z.string().trim().min(1).max(120) });
export const systemsTestStepParamsSchema = z.object({ suiteId: positiveId, stepId: positiveId });

/**
 * Bloque del ecosistema en la ruta: `ATLAS_BACKEND`, `DECISION_ENGINE`, `ERP_BACKEND`.
 *
 * La forma se valida (mayúsculas y guion bajo) pero NO se cierra la lista contra el registro de
 * bloques: el registro es código de dominio y el esquema es el borde. Si el código no existe, el
 * servicio contesta que ese bloque no es federable, con ese motivo, en vez de un 400 genérico que
 * obligaría a adivinar si el problema es la ortografía o la configuración.
 */
export const systemsBlockParamsSchema = z.object({
  systemCode: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'systemCode usa el código del bloque en mayúsculas, por ejemplo DECISION_ENGINE.'),
});

export type SystemsEndpointParamsDto = z.infer<typeof systemsEndpointParamsSchema>;
export type SystemsToolParamsDto = z.infer<typeof systemsToolParamsSchema>;
export type SystemsEntityParamsDto = z.infer<typeof systemsEntityParamsSchema>;
export type SystemsTableImpactParamsDto = z.infer<typeof systemsTableImpactParamsSchema>;
export type SystemsSuiteParamsDto = z.infer<typeof systemsSuiteParamsSchema>;
export type SystemsRunParamsDto = z.infer<typeof systemsRunParamsSchema>;
export type SystemsDataImpactParamsDto = z.infer<typeof systemsDataImpactParamsSchema>;
export type SystemsFieldImpactParamsDto = z.infer<typeof systemsFieldImpactParamsSchema>;
export type SystemsDomainParamsDto = z.infer<typeof systemsDomainParamsSchema>;
export type SystemsBlockParamsDto = z.infer<typeof systemsBlockParamsSchema>;
export type SystemsToolRequirementParamsDto = z.infer<typeof systemsToolRequirementParamsSchema>;
export type SystemsStressProfileParamsDto = z.infer<typeof systemsStressProfileParamsSchema>;
export type SystemsRequestParamsDto = z.infer<typeof systemsRequestParamsSchema>;
export type SystemsTestStepParamsDto = z.infer<typeof systemsTestStepParamsSchema>;
