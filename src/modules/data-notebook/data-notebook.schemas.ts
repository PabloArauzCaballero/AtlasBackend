/**
 * @file Esquemas de validación: fijan la forma admitida en el borde HTTP.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system valida los parámetros con los que el cuaderno pide una página de datos.
 */
import { z } from 'zod';
import {
  DATA_NOTEBOOK_LIMITS,
  NOTEBOOK_CELL_LANGUAGES,
  NOTEBOOK_DATASET_CODE_MESSAGE,
  NOTEBOOK_DATASET_CODE_PATTERN,
  NOTEBOOK_HISTORY_LANGUAGES,
} from './data-notebook.constants.js';

/**
 * El código de dataset, con la MISMA regla en el historial y en el cuaderno guardado.
 *
 * Eran dos reglas distintas y las dos estaban mal, cada una en un sentido. El historial exigía
 * `[a-z0-9-]+`, así que **ninguna celda ejecutada sobre una vista del motor llegaba a registrarse**:
 * el `POST` respondía 400, el portal se lo traga a propósito para no perder el trabajo de nadie, y
 * la trazabilidad de esas ejecuciones desaparecía en silencio — justo la mitad del cuaderno que
 * lee decisiones de crédito. El cuaderno guardado, al revés, admitía cualquier mezcla de letras,
 * puntos y dos puntos.
 */
const datasetCodeSchema = z
  .string()
  .trim()
  .max(64)
  .regex(NOTEBOOK_DATASET_CODE_PATTERN, NOTEBOOK_DATASET_CODE_MESSAGE);

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
    language: z.enum(NOTEBOOK_HISTORY_LANGUAGES),
    source: z.string().trim().min(1).max(DATA_NOTEBOOK_LIMITS.maxHistorySourceLength),
    datasetCode: datasetCodeSchema.optional(),
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
  /**
   * Cuántas entradas se saltan. Es la paginación del historial, y va por desplazamiento y no por
   * cursor a propósito: la pantalla enseña «página 3 de 12», que necesita saber cuántas hay en
   * total, y un cursor da lo siguiente sin decir jamás cuánto queda.
   *
   * Sin tope superior por diseño: el desplazamiento sólo puede llegar hasta donde llegue el propio
   * historial de quien pregunta, y pedir más allá devuelve una página vacía, que es la respuesta
   * correcta y no un error.
   */
  offset: z.coerce.number().int().min(0).default(0),
});

export type NotebookHistoryQueryDto = z.infer<typeof notebookHistoryQuerySchema>;

/**
 * Un cuaderno guardado: el documento Y lo que cada celda arrojó.
 *
 * Guardar el resultado es una decisión de producto —un cuaderno que se reabre en blanco no
 * conserva el avance, y el avance ES el trabajo—, y trae una consecuencia que hay que tener a la
 * vista: dentro de `outcome.table` viajan FILAS de clientes. Vienen ya enmascaradas por
 * `read_api`, pero son una copia fuera de ella, sin caducidad y editable por su dueño. Tres cosas
 * lo acotan, y ninguna es cosmética:
 *
 *  1. El tope de bytes del documento entero (`maxNotebookBytes`), que el servicio comprueba antes
 *     de escribir. Sin él, veinte mil filas en JSONB por cuaderno y cien cuadernos por persona.
 *  2. `savedAt` en cada resultado: la pantalla lo rotula al restaurarlo. Un número de la semana
 *     pasada junto al dataset de hoy, sin fecha, es la forma más silenciosa de equivocarse.
 *  3. Sigue sin haber ejecución en el servidor: esto se GUARDA, no se interpreta.
 *
 * El `datasetCode` admite aquí dos formas y sólo dos (ver `datasetCodeSchema`): la de una vista de
 * `read_api` y la de una del motor, `motor:esquema.tabla`. La de la ruta de filas sigue siendo más
 * estrecha (`[a-z0-9-]`) porque por ahí sólo se sirven las de AtlasBackend.
 */
const notebookTableSchema = z.object({
  columns: z.array(z.string()),
  // Esta versión de Zod exige el esquema de la CLAVE además del del valor.
  rows: z.array(z.record(z.string(), z.unknown())),
});

const notebookOutcomeSchema = z
  .object({
    status: z.enum(['ok', 'error']),
    /** El valor de la última expresión, ya serializable. */
    value: z.unknown().optional(),
    table: notebookTableSchema.optional(),
    /** Gráficos como `data:image/png;base64,…`. Son lo que más pesa: el tope los vigila. */
    images: z.array(z.string()).optional(),
    error: z.string().optional(),
    logs: z.array(z.string()),
    durationMs: z.number().int().min(0),
    executionCount: z.number().int().min(0).nullable().optional(),
    /** Cuándo se produjo. Lo pone el cliente al guardar y la pantalla lo enseña al restaurar. */
    savedAt: z.string().max(40),
  })
  .strict();

const notebookCellSchema = z
  .object({
    kind: z.enum(['code', 'markdown']),
    language: z.enum(NOTEBOOK_CELL_LANGUAGES),
    source: z.string().max(DATA_NOTEBOOK_LIMITS.maxHistorySourceLength),
    outcome: notebookOutcomeSchema.nullish(),
  })
  .strict();

export const notebookDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    datasetCode: datasetCodeSchema.nullish(),
    cells: z.array(notebookCellSchema).min(1).max(DATA_NOTEBOOK_LIMITS.maxNotebookCells),
  })
  .strict();

export type NotebookDocumentDto = z.infer<typeof notebookDocumentSchema>;

export const notebookDocumentParamsSchema = z.object({
  // El identificador es un entero de la propia tabla. Se acota aquí para que un valor con forma de
  // inyección no llegue siquiera a la consulta.
  id: z.string().regex(/^\d+$/, 'El identificador de cuaderno es numérico.'),
});

export type NotebookDocumentParamsDto = z.infer<typeof notebookDocumentParamsSchema>;
