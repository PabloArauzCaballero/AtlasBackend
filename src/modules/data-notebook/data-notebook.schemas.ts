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

/**
 * Lo que se registra de una celda ejecutada. Fíjate en lo que NO está.
 *
 * No hay campo para las filas devueltas, ni lo habrá: el historial existe para saber qué se
 * preguntó, y guardar además lo obtenido lo convertiría en una segunda copia de datos personales
 * fuera de `read_api`, sin enmascarado y sin caducidad. Al no declararse aquí, un cliente que las
 * mandara por su cuenta se las encuentra descartadas en el borde — `.strict()` rechaza la
 * petición en vez de guardar lo que nadie pidió guardar.
 */
export const notebookHistoryEntrySchema = z
  .object({
    // 'sql' entra aqui porque la consola SQL guarda en la MISMA tabla: partir el historial en dos
    // obligaria a quien audite a acordarse de mirar en dos sitios, y el dia que se olvide veria la
    // mitad de lo que se consulto.
    language: z.enum(['python', 'javascript', 'sql']),
    source: z.string().trim().min(1).max(DATA_NOTEBOOK_LIMITS.maxHistorySourceLength),
    datasetCode: z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    datasetPage: z.coerce.number().int().min(1).optional(),
    rowCount: z.coerce.number().int().min(0).optional(),
    durationMs: z.coerce.number().int().min(0).optional(),
    status: z.enum(['ok', 'error']),
    errorMessage: z.string().trim().max(500).optional(),
  })
  .strict();

export type NotebookHistoryEntryDto = z.infer<typeof notebookHistoryEntrySchema>;

export const notebookHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(DATA_NOTEBOOK_LIMITS.historyPageSize).default(DATA_NOTEBOOK_LIMITS.historyPageSize),
});

export type NotebookHistoryQueryDto = z.infer<typeof notebookHistoryQuerySchema>;
