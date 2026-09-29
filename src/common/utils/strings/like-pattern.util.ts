/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de strings sin introducir reglas de un dominio específico.
 */

/**
 * Patrón `ILIKE '%…%'` con los comodines del usuario escapados.
 *
 * Sin escapar, quien busca `user_id` encontraba también `userXid` (el `_` es «cualquier carácter») y
 * un `%` suelto casaba con todo. La barra invertida es el carácter de escape por defecto de `LIKE` e
 * `ILIKE` en PostgreSQL, así que también se escapa ella misma.
 */
export function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}
