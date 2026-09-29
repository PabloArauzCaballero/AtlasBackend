/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de pagination sin introducir reglas de un dominio específico.
 */
export type PaginationInput = {
  page: number;
  limit: number;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function toOffset(input: PaginationInput): number {
  return (input.page - 1) * input.limit;
}

export function buildPaginationMeta(input: PaginationInput, total: number): PaginationMeta {
  return {
    page: input.page,
    limit: input.limit,
    total,
    totalPages: Math.ceil(total / input.limit),
  };
}

/** El `meta` canónico para un listado que pagina por `offset` (se conserva por compatibilidad). */
export function paginationMetaFromOffset(input: { limit: number; offset: number }, total: number): PaginationMeta {
  return buildPaginationMeta({ page: Math.floor(input.offset / input.limit) + 1, limit: input.limit }, total);
}
