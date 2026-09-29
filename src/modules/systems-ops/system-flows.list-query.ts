/**
 * @file Consulta de listas de Flujos que se calculan en memoria: búsqueda de texto y página.
 * @business Esta pieza hace que la deriva de permisos y el trabajo pendiente se puedan buscar, filtrar y recorrer por páginas.
 * @system compara texto sin distinguir mayúsculas y SIN comodines (`%` y `_` son texto), y corta la página con el `meta` canónico.
 */
import { z } from 'zod';
import { buildPaginationMeta, type PaginationMeta } from '../../common/utils/pagination/pagination.util.js';

const paging = {
  /** Sin `limit` no se pagina: la respuesta es la de siempre. */
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).optional(),
};

export const DRIFT_SEVERITIES = ['SIN_GUARDA', 'PUBLIC', 'SOLO_ROL'] as const;
export const PENDING_WORK_STATES = ['pending', 'failed', 'skipped'] as const;

export const rbacDriftQuerySchema = z.object({
  ...paging,
  q: z.string().trim().min(1).max(160).optional(),
  severity: z.enum(DRIFT_SEVERITIES).optional(),
  clientCode: z.string().trim().min(1).max(60).optional(),
});
export type RbacDriftQueryDto = z.infer<typeof rbacDriftQuerySchema>;

export const pendingWorkQuerySchema = z.object({
  ...paging,
  /** Se valida a mano en el controlador: un valor inválido cae a 30 días, no a 400 (así era antes). */
  windowDays: z.string().optional(),
  q: z.string().trim().min(1).max(160).optional(),
  state: z.enum(PENDING_WORK_STATES).optional(),
});
export type PendingWorkQueryDto = z.infer<typeof pendingWorkQuerySchema>;

/** ¿Alguno de los campos contiene el texto? Comparación literal: `50%` no casa con `500`. */
export function containsText(needle: string | undefined, ...fields: (string | null | undefined)[]): boolean {
  if (!needle) return true;
  const buscado = needle.toLocaleLowerCase('es');
  return fields.some((field) => (field ?? '').toLocaleLowerCase('es').includes(buscado));
}

/** La página pedida; sin `limit` devuelve todo y no inventa un `meta`. */
export function slicePage<T>(rows: T[], page: number, limit: number | undefined): { items: T[]; meta?: PaginationMeta } {
  if (limit === undefined) return { items: rows };
  const desde = (page - 1) * limit;
  return { items: rows.slice(desde, desde + limit), meta: buildPaginationMeta({ page, limit }, rows.length) };
}
