/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { z } from 'zod';

export const customerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export type CustomerIdParamsDto = z.infer<typeof customerIdParamsSchema>;
