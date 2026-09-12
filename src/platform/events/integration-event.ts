/**
 * @file Sobre de evento de integración (AT-032): lo que viaja entre productor, relay y consumidores.
 * @business Un hecho de negocio («la solicitud CRA-1 fue presentada») tiene identidad global, versión de
 *   esquema, productor y agregado; un evento técnico de auditoría HTTP («POST /x completed») es otra
 *   categoría y no se confunde con él.
 * @system Valores serializables. `fromOutboxRow` traduce una fila del outbox (incluidas las heredadas sin
 *   sobre) al envelope conservando la identidad de deduplicación (`event_id`). `validateEnvelope`
 *   rechaza versiones desconocidas, ámbito inválido y campos prohibidos ANTES de publicar.
 */
export type EventScope = Readonly<{ kind: 'tenant'; tenantId: string } | { kind: 'platform' }>;

export type EventCategory = 'domain' | 'technical';

export type IntegrationEvent<TPayload = Readonly<Record<string, unknown>>> = Readonly<{
  eventId: string;
  type: string;
  category: EventCategory;
  schemaVersion: number;
  producer: string;
  scope: EventScope;
  aggregate: Readonly<{ type: string; id: string | null; version: number | null }>;
  occurredAt: string;
  correlationId: string | null;
  causationId: string | null;
  payload: TPayload;
}>;

export type OutboxRowLike = {
  eventId: string;
  eventCode: string;
  aggregateType: string;
  aggregateId: string | null;
  aggregateVersion?: string | number | null;
  schemaVersion?: number | null;
  producer?: string | null;
  tenantId: string | number | null;
  eventPayloadJson: Record<string, unknown> | null;
  correlationId: string | null;
  causationId?: string | null;
  createdAtValue: Date;
};

/** Eventos técnicos: los emite el interceptor HTTP con este agregado; no son hechos de dominio. */
export const TECHNICAL_AGGREGATE_TYPE = 'api_command';

export function categoryOf(row: { aggregateType: string; eventCode: string }): EventCategory {
  return row.aggregateType === TECHNICAL_AGGREGATE_TYPE || /_completed$/.test(row.eventCode) ? 'technical' : 'domain';
}

/** Traduce una fila del outbox (heredada o nueva) al sobre. La identidad es `event_id`, nunca `_id`. */
export function fromOutboxRow(row: OutboxRowLike): IntegrationEvent {
  const version = row.aggregateVersion === null || row.aggregateVersion === undefined ? null : Number(row.aggregateVersion);
  return Object.freeze({
    eventId: row.eventId,
    type: row.eventCode,
    category: categoryOf(row),
    schemaVersion: row.schemaVersion ?? 1,
    producer: row.producer ?? 'legacy',
    scope: row.tenantId === null ? { kind: 'platform' as const } : { kind: 'tenant' as const, tenantId: String(row.tenantId) },
    aggregate: Object.freeze({ type: row.aggregateType, id: row.aggregateId, version }),
    occurredAt: row.createdAtValue.toISOString(),
    correlationId: row.correlationId,
    causationId: row.causationId ?? null,
    payload: Object.freeze({ ...(row.eventPayloadJson ?? {}) }),
  });
}

/** Claves que un payload de evento nunca lleva: se rechazan antes de publicar, no se redactan después. */
const FORBIDDEN_PAYLOAD_KEYS = /(password|secret|token|otp|verificationCode|documentNumber|rawPayload|stack|primaryPhone|primaryEmail)/i;

export type EnvelopeValidation = Readonly<
  | { ok: true }
  | { ok: false; code: 'UNKNOWN_SCHEMA_VERSION' | 'INVALID_SCOPE' | 'FORBIDDEN_PAYLOAD_KEY' | 'MISSING_IDENTITY'; detail: string }
>;

/** Versiones de esquema que este proceso entiende, por tipo. Un tipo no listado admite la versión 1. */
export type SchemaCatalog = Readonly<Record<string, readonly number[]>>;

/** Profundidad máxima al buscar claves prohibidas: un payload de evento no anida más que esto. */
const MAX_PAYLOAD_DEPTH = 6;

function findForbiddenKey(value: unknown, depth: number, path = ''): string | null {
  if (depth > MAX_PAYLOAD_DEPTH || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findForbiddenKey(entry, depth + 1, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (FORBIDDEN_PAYLOAD_KEYS.test(key)) return here;
    const found = findForbiddenKey(entry, depth + 1, here);
    if (found) return found;
  }
  return null;
}

export function validateEnvelope(event: IntegrationEvent, catalog: SchemaCatalog = {}): EnvelopeValidation {
  if (!event.eventId || !event.type) return { ok: false, code: 'MISSING_IDENTITY', detail: 'eventId y type son obligatorios' };
  const known = catalog[event.type] ?? [1];
  if (!known.includes(event.schemaVersion))
    return { ok: false, code: 'UNKNOWN_SCHEMA_VERSION', detail: `${event.type} v${event.schemaVersion}; conocidas: ${known.join(',')}` };
  if (event.scope.kind === 'tenant' && !/^\d+$/.test(event.scope.tenantId))
    return { ok: false, code: 'INVALID_SCOPE', detail: `tenant «${event.scope.tenantId}»` };
  // Revisión independiente A, hallazgo 12: antes sólo se miraba el primer nivel, así que
  // `{ customer: { password } }` pasaba el filtro. Ahora se recorre en profundidad, con tope.
  const offending = findForbiddenKey(event.payload, 0);
  if (offending) return { ok: false, code: 'FORBIDDEN_PAYLOAD_KEY', detail: offending };
  return { ok: true };
}
