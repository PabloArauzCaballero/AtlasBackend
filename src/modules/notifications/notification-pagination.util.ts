/**
 * @file Utilidad: arma la respuesta paginada estándar de los listados de notificaciones.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
export function paginate<T, R>(rows: T[], total: number, query: { page: number; limit: number }, map: (row: T) => R) {
  return {
    data: rows.map(map),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}
