/**
 * @file Contrato de entrada: parámetros de la sección Procesos.
 * @business Esta pieza impide que un código o un id mal formado llegue a una consulta.
 * @system esquemas Zod de `internal/processes`.
 */
import { z } from 'zod';

export const processCodeParamsSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{2,79}$/, 'Código de proceso inválido.'),
});
export type ProcessCodeParamsDto = z.infer<typeof processCodeParamsSchema>;

export const processInstanceParamsSchema = processCodeParamsSchema.extend({
  instanceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identificador de instancia inválido.'),
});
export type ProcessInstanceParamsDto = z.infer<typeof processInstanceParamsSchema>;

export const processInstancesQuerySchema = z.object({
  status: z
    .string()
    .regex(/^[A-Za-z_]{1,40}$/)
    .optional(),
  search: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProcessInstancesQueryDto = z.infer<typeof processInstancesQuerySchema>;
