/**
 * @file Doble en memoria del outbox transaccional (AT-051): mismo contrato que `SequelizeOutboxWriter`.
 * @business Un caso de uso se prueba sin base con este doble; si el doble aceptara lo que la base
 *   rechaza, la prueba del caso de uso sería mentira. Por eso comparte la suite de contrato.
 * @system Valida el sobre con `validateEnvelope` (misma función que el escritor real) y rechaza el
 *   `dedupKey` repetido para el mismo (ámbito, tipo) igual que el índice único parcial
 *   `ux_outbox_tenant_event_idempotency_key`.
 */
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../../src/platform/contracts/application-error.js';
import { validateEnvelope } from '../../../src/platform/events/integration-event.js';
import type { OutboxAppend, OutboxAppended, TransactionalOutbox } from '../../../src/platform/events/transactional-outbox.port.js';

export class InMemoryOutbox implements TransactionalOutbox {
  readonly rows: Array<OutboxAppend & OutboxAppended> = [];

  async append(event: OutboxAppend): Promise<OutboxAppended> {
    const check = validateEnvelope({
      eventId: 'pending',
      type: event.type,
      category: 'domain',
      schemaVersion: event.schemaVersion ?? 1,
      producer: event.producer,
      scope: event.scope,
      aggregate: { type: event.aggregate.type, id: event.aggregate.id, version: event.aggregate.version ?? null },
      occurredAt: new Date().toISOString(),
      correlationId: event.correlationId ?? null,
      causationId: event.causationId ?? null,
      payload: event.payload,
    });
    if (!check.ok) throw new ApplicationError({ kind: 'invalid', code: `EVENT_${check.code}`, publicDetail: check.detail });
    const tenantId = event.scope.kind === 'tenant' ? event.scope.tenantId : null;
    if (event.dedupKey) {
      const duplicate = this.rows.find(
        (row) =>
          row.dedupKey === event.dedupKey &&
          row.type === event.type &&
          (row.scope.kind === 'tenant' ? row.scope.tenantId : null) === tenantId,
      );
      if (duplicate) throw new ApplicationError({ kind: 'conflict', code: 'OUTBOX_DEDUP_KEY_TAKEN' });
    }
    const appended = { eventId: randomUUID(), outboxRowId: String(this.rows.length + 1) };
    this.rows.push({ ...event, ...appended });
    return Object.freeze(appended);
  }
}
