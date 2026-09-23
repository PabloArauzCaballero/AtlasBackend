/**
 * Fija el orden de los mapas OpenAPI que Nest construye según el recorrido de imports.
 * Conserva los arrays: por ejemplo, el orden de tags y de alternativas de seguridad sí puede
 * comunicar una prioridad de lectura al consumidor.
 */
type SortableDocument = {
  paths: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
};

const HTTP_METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortRecord<Value>(record: Record<string, Value>, compare = compareCodepoints): Record<string, Value> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compare(left, right)));
}

function comparePathItemKeys(left: string, right: string): number {
  const leftMethod = HTTP_METHOD_ORDER.indexOf(left);
  const rightMethod = HTTP_METHOD_ORDER.indexOf(right);
  if (leftMethod >= 0 && rightMethod >= 0) return leftMethod - rightMethod;
  if (leftMethod >= 0) return 1;
  if (rightMethod >= 0) return -1;
  return compareCodepoints(left, right);
}

export function stableSortOpenApiDocument<Document extends SortableDocument>(document: Document): Document {
  document.paths = sortRecord(
    Object.fromEntries(
      Object.entries(document.paths).map(([path, item]) => [
        path,
        item && typeof item === 'object' && !Array.isArray(item) ? sortRecord(item as Record<string, unknown>, comparePathItemKeys) : item,
      ]),
    ),
  ) as Document['paths'];
  if (document.components?.schemas) {
    document.components.schemas = sortRecord(document.components.schemas);
  }
  return document;
}
