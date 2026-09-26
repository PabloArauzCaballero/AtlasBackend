/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { escapeRegex } from '../../common/utils/strings/regex.util.js';

export function normalizeEndpointPath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? path;
  return withoutQuery
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/^api\/v[0-9]+\//, '')
    .replace(/\/+/g, '/');
}

export function normalizeFullPath(path: string): string {
  const normalized = normalizeEndpointPath(path);
  return normalized ? `/api/v1/${normalized}` : '/api/v1';
}

/**
 * El escaneo de código (SOURCE_SCAN) lee las rutas de los decoradores de Nest en sintaxis Express
 * (`:customerId`); el contrato OpenAPI (OPENAPI_CONTRACT) describe la MISMA ruta con la suya
 * (`{customerId}`). `endpointTemplateToRegex` sólo reconoce `:param` como comodín — un `fullPath`
 * con `{customerId}` literal nunca hace match contra una petición real, aparte de que ambos modos
 * catalogarían la misma ruta como dos filas (`code` y `full_path` distintos) en vez de una sola
 * actualizada. Se normaliza a la sintaxis Express, la única que el resto del catálogo entiende.
 */
export function normalizePathParamSyntax(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
}

export function buildEndpointCode(method: string, fullPath: string): string {
  const normalizedPath = normalizeEndpointPath(normalizePathParamSyntax(fullPath))
    .replace(/:([A-Za-z0-9_]+)/g, 'by_$1')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
  return `${method.toUpperCase()}_${normalizedPath || 'ROOT'}`.slice(0, 180);
}

export function moduleFromPath(fullPath: string): string {
  const normalized = normalizeEndpointPath(fullPath);
  const [first, second] = normalized.split('/');
  if (first === 'operations' && second) return second.replace(/-/g, '_');
  return (first || 'root').replace(/-/g, '_');
}

export function routeNameFromMethodAndPath(method: string, fullPath: string): string {
  return `${method.toUpperCase()} /${normalizeEndpointPath(fullPath)}`;
}

export function endpointTemplateToRegex(fullPath: string): RegExp {
  const normalized = normalizeFullPath(fullPath);
  const escapedSegments = normalized
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment.startsWith(':')) return '[^/]+';
      return escapeRegex(segment);
    })
    .join('/');
  return new RegExp(`^${escapedSegments}/?$`);
}

export function endpointPathMatches(templatePath: string, actualPath: string): boolean {
  return endpointTemplateToRegex(templatePath).test(normalizeFullPath(actualPath));
}

export function endpointPathSpecificity(fullPath: string): number {
  return normalizeFullPath(fullPath)
    .split('/')
    .filter(Boolean)
    .reduce((score, segment) => score + (segment.startsWith(':') ? 1 : 4), 0);
}
