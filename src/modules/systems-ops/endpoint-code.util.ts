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

export function buildEndpointCode(method: string, fullPath: string): string {
  const normalizedPath = normalizeEndpointPath(fullPath)
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
