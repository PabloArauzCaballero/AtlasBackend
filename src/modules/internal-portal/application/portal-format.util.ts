/**
 * Helpers de normalización y paginación compartidos por los servicios del portal interno.
 *
 * Extraídos de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios de comportamiento:
 * son funciones puras, sin dependencias de Nest ni de Sequelize, reutilizadas por los servicios de
 * glosario, gobierno, calidad, linaje, operaciones, reportes y búsqueda.
 */

export type Query = Record<string, string | number | boolean | undefined>;
export type Row = Record<string, unknown>;
export type Page = { page: number; limit: number; offset: number };

export function clean(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export function nullableText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function id(value: unknown): string {
  return clean(value, '0');
}

export function intValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function boolValue(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1' || value === 't';
  return fallback;
}

export function jsonValue(value: unknown): Row {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Row;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Row;
    } catch {
      return { value };
    }
  }
  return {};
}

export function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return new Date(value).toISOString();
  return null;
}

export function parsePage(query: Query): Page {
  const page = Math.max(1, intValue(query.page, 1));
  const limit = Math.min(100, Math.max(1, intValue(query.limit ?? query.pageSize, 20)));
  return { page, limit, offset: (page - 1) * limit };
}

export function paginate<T>(items: T[], query: Query) {
  const page = parsePage(query);
  const total = items.length;
  const sliced = items.slice(page.offset, page.offset + page.limit);
  return { items: sliced, meta: { page: page.page, limit: page.limit, total, totalPages: Math.max(1, Math.ceil(total / page.limit)) } };
}

export function containsQuery(row: object, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return Object.values(row as Row).some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(needle),
  );
}

export function policyId(kind: string, rawId: unknown): string {
  return `${kind}:${id(rawId)}`;
}

export function splitPolicyId(value: string): { kind: string | null; rawId: string } {
  const decoded = decodeURIComponent(value);
  const [kind, rawId] = decoded.includes(':') ? decoded.split(':', 2) : [null, decoded];
  return { kind, rawId };
}
