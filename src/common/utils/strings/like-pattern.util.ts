/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de strings sin introducir reglas de un dominio específico.
 */

/**
 * Patrón `%texto%` para `LIKE`/`ILIKE` con los comodines del usuario ESCAPADOS.
 *
 * Sin escapar, buscar `50%` o `user_id` no busca ese texto: `%` casa con cualquier cosa y `_` con
 * cualquier carácter, así que un buscador «que funciona» devuelve filas que no contienen lo escrito.
 * La barra invertida es el carácter de escape por omisión de PostgreSQL en `LIKE`, por eso también
 * se escapa ella misma.
 */
export function containsLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}
