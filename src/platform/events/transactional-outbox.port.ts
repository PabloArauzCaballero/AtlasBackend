/**
 * @file Puerto de outbox transaccional (AT-033): el evento se escribe con el agregado, o no se escribe.
 * @business Si la solicitud se confirma, su evento existe; si el evento no puede escribirse, la solicitud
 *   no se confirma. Nunca «después del commit»: el proceso puede morir entre medias.
 * @system `append` sólo se obtiene a través de la sesión de una unidad de trabajo local, ya ligada a la
 *   transacción del propietario. No hay outbox central remoto: eso sería escritura dual.
 */
export type OutboxAppend = Readonly<{
  type: string;
  scope: Readonly<{ kind: 'tenant'; tenantId: string } | { kind: 'platform' }>;
  aggregate: Readonly<{ type: string; id: string | null; version?: number | null }>;
  payload: Readonly<Record<string, unknown>>;
  producer: string;
  schemaVersion?: number;
  /** Deduplicación por productor: mismo valor → misma fila. */
  dedupKey?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  priority?: number;
}>;

export type OutboxAppended = Readonly<{ eventId: string; outboxRowId: string }>;

export interface TransactionalOutbox {
  append(event: OutboxAppend): Promise<OutboxAppended>;
}
