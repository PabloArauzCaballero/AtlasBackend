/**
 * @file Esquemas de validación: fijan la forma admitida en el borde HTTP.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system valida los parámetros con los que el cuaderno pide una página de datos.
 */
import { z } from 'zod';
import { DATA_NOTEBOOK_LIMITS } from './data-notebook.constants.js';

export const notebookDatasetParamsSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    // El código se busca después contra el catálogo cerrado; acotar aquí la forma evita que un
    // valor absurdo llegue siquiera a compararse y deja el mensaje de error en el borde.
    .regex(/^[a-z0-9-]+$/, 'El código de dataset sólo admite minúsculas, dígitos y guiones.'),
});

export type NotebookDatasetParamsDto = z.infer<typeof notebookDatasetParamsSchema>;

export const notebookRowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(DATA_NOTEBOOK_LIMITS.maxPageSize).default(DATA_NOTEBOOK_LIMITS.defaultPageSize),
  orderBy: z.string().trim().min(1).max(63).optional(),
  // Se admite en minúsculas porque es lo que escribe cualquiera, y rechazar `desc` sería una
  // pedantería que sólo produce un 400 sin información.
  orderDirection: z
    .enum(['ASC', 'DESC', 'asc', 'desc'])
    .default('DESC')
    .transform((value) => value.toUpperCase() as 'ASC' | 'DESC'),
});

export type NotebookRowsQueryDto = z.infer<typeof notebookRowsQuerySchema>;
