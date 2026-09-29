/**
 * @file Forma canónica de una ruta HTTP para comparar lo que cita la documentación con lo que existe.
 * @business Dos maneras de escribir la misma ruta (`:id` o `{id}`) no deben contar como rutas distintas.
 * @system función pura, sin E/S.
 */
/** Forma canónica para comparar rutas: `{id}`, `:id` y `<id>` son el mismo segmento variable. */
export function routeShape(path: string): string {
  const withoutPrefix = path.replace(/^\/api\/v1(?=\/|$)/, '');
  const normalized = withoutPrefix
    .replace(/\{[^}/]+\}/g, '{}')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}')
    .replace(/<[^>/]+>/g, '{}')
    .replace(/\/+$/, '');
  return normalized === '' ? '/' : normalized;
}
