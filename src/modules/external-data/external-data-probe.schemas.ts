/**
 * @file Esquema Zod del cuerpo de «Probar proveedor».
 * @business Valida la consulta de prueba de un proveedor externo antes de ejecutarla.
 * @system separado de external-data.schemas.ts para no pasar el límite de líneas.
 */
import { z } from 'zod';
import { decisionStageSchema, idStringSchema, scenarioSchema } from './external-data.schemas.js';

/**
 * Cuerpo de «Probar proveedor» (`POST /admin/external-providers/:code/test`). Antes era un
 * `Record<string, unknown>` sin validar: `queryType` en minúsculas no casaba con ninguna política de
 * costo (`findCostPolicy` compara exacto) y caía en NO_POLICY_CONFIGURED_ALLOWING_DEFAULT, y un
 * `customerId` no numérico llegaba a una columna BIGINT. Todo opcional: los valores por defecto los
 * pone `providerProbeRequest`.
 */
export const providerProbeSchema = z
  .object({
    customerId: idStringSchema.optional(),
    queryType: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .transform((value) => value.toUpperCase())
      .optional(),
    purpose: z.string().trim().min(3).max(100).optional(),
    decisionStage: decisionStageSchema.optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    scenario: scenarioSchema,
  })
  .default({});
export type ProviderProbeDto = z.infer<typeof providerProbeSchema>;
