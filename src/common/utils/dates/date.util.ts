/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de dates sin introducir reglas de un dominio específico.
 */
export function toIsoOrNull(date: Date | string | null): string | null {
  if (!date) return null;
  return date instanceof Date ? date.toISOString() : date;
}
