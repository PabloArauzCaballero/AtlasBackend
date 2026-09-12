/**
 * @file AT-032 — sobre de evento: traducción de filas legacy, validación y categorías.
 * @business Una fila vieja conserva su identidad de deduplicación; un payload con secretos no se publica;
 *   un evento técnico no se confunde con un hecho de dominio.
 * @system Funciones puras de `integration-event.ts`, `retry-policy.ts` y el registro de consumidores.
 */
import { describe, expect, it } from '@jest/globals';
import { ConsumerRegistry } from '../../../src/platform/events/consumer-registry.js';
import { categoryOf, fromOutboxRow, validateEnvelope } from '../../../src/platform/events/integration-event.js';
import { authorizeReplay, decideOrder, decideRetry } from '../../../src/platform/events/retry-policy.js';

const legacyRow = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventCode: 'customer.lifecycle.blocked',
  aggregateType: 'customer',
  aggregateId: '42',
  tenantId: 7,
  eventPayloadJson: { previousStatus: 'active', newStatus: 'blocked' },
  correlationId: null,
  createdAtValue: new Date('2026-09-11T00:00:00.000Z'),
};

describe('sobre de evento (AT-032)', () => {
  it('una fila legacy (sin sobre) se traduce conservando event_id, con producer=legacy y schemaVersion 1', () => {
    const event = fromOutboxRow(legacyRow);
    expect(event).toMatchObject({
      eventId: legacyRow.eventId,
      type: 'customer.lifecycle.blocked',
      category: 'domain',
      schemaVersion: 1,
      producer: 'legacy',
      scope: { kind: 'tenant', tenantId: '7' },
      aggregate: { type: 'customer', id: '42', version: null },
      occurredAt: '2026-09-11T00:00:00.000Z',
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(fromOutboxRow(legacyRow).eventId).toBe(fromOutboxRow(legacyRow).eventId);
  });

  it('un evento técnico HTTP se clasifica como technical, no domain', () => {
    expect(categoryOf({ aggregateType: 'api_command', eventCode: 'post_api_v1_x_completed' })).toBe('technical');
    expect(categoryOf({ aggregateType: 'customer', eventCode: 'customer.lifecycle.blocked' })).toBe('domain');
  });

  it('versión desconocida o tenant inválido: rechazo definido, no consumo silencioso', () => {
    const event = fromOutboxRow({ ...legacyRow, schemaVersion: 9 });
    expect(validateEnvelope(event, { 'customer.lifecycle.blocked': [1, 2] })).toMatchObject({ ok: false, code: 'UNKNOWN_SCHEMA_VERSION' });
    expect(validateEnvelope(fromOutboxRow({ ...legacyRow, tenantId: 'abc' as never }))).toMatchObject({ ok: false, code: 'INVALID_SCOPE' });
    expect(validateEnvelope(fromOutboxRow({ ...legacyRow, tenantId: null })).ok).toBe(true);
  });

  it('payload con campos prohibidos: el contrato rechaza antes de publicar', () => {
    const event = fromOutboxRow({ ...legacyRow, eventPayloadJson: { customerId: '42', otp: '123456' } });
    expect(validateEnvelope(event)).toMatchObject({ ok: false, code: 'FORBIDDEN_PAYLOAD_KEY', detail: 'otp' });
  });
});

describe('política de reintento y orden (AT-036)', () => {
  it('fallo transitorio: backoff exponencial con jitter acotado; permanente o agotado: DLQ', () => {
    const now = new Date('2026-09-11T00:00:00.000Z');
    const first = decideRetry({ attempts: 1, now, random: () => 0 });
    const second = decideRetry({ attempts: 2, now, random: () => 0 });
    expect(first).toMatchObject({ action: 'retry', availableAt: new Date(now.getTime() + 60_000) });
    expect(second).toMatchObject({ action: 'retry', availableAt: new Date(now.getTime() + 120_000) });
    expect(decideRetry({ attempts: 1, now, error: { code: 'EVENT_UNKNOWN_SCHEMA_VERSION' } })).toMatchObject({ action: 'dead_letter' });
    expect(decideRetry({ attempts: 5, now })).toMatchObject({ action: 'dead_letter', reason: 'MAX_ATTEMPTS_5' });
  });

  it('versión 3 antes que 2: espera con el hueco identificado; versión ya aplicada: obsoleta; sin versión: aplica', () => {
    expect(decideOrder({ lastApplied: 1, incoming: 3 })).toEqual({ action: 'wait', missing: [2] });
    expect(decideOrder({ lastApplied: 3, incoming: 2 })).toEqual({ action: 'stale' });
    expect(decideOrder({ lastApplied: 1, incoming: 2 })).toEqual({ action: 'apply' });
    expect(decideOrder({ lastApplied: null, incoming: null })).toEqual({ action: 'apply' });
  });

  it('replay sin permiso o de otro tenant: denegado', () => {
    expect(authorizeReplay({ tenantId: '1', permissions: [] }, { tenantId: '1' })).toEqual({
      allowed: false,
      code: 'REPLAY_PERMISSION_DENIED',
    });
    expect(authorizeReplay({ tenantId: '2', permissions: ['events.dead_letter.replay'] }, { tenantId: '1' })).toEqual({
      allowed: false,
      code: 'REPLAY_TENANT_MISMATCH',
    });
    expect(authorizeReplay({ tenantId: '1', permissions: ['events.dead_letter.replay'] }, { tenantId: '1' })).toEqual({ allowed: true });
  });
});

describe('registro de consumidores (AT-035)', () => {
  const consumer = (consumerId: string, versions: readonly number[] = [1]) => ({
    consumerId,
    subscriptions: { 'credit.application.submitted': versions },
    handle: async () => undefined,
  });

  it('rechaza identidades duplicadas o inválidas y suscripciones sin versiones', () => {
    expect(() => new ConsumerRegistry([consumer('notifications'), consumer('notifications')])).toThrow('CONSUMER_ID_DUPLICATED');
    expect(() => new ConsumerRegistry([consumer('X')])).toThrow('CONSUMER_ID_INVALID');
    expect(() => new ConsumerRegistry([consumer('audit', [])])).toThrow('CONSUMER_SUBSCRIPTION_WITHOUT_VERSIONS');
  });

  it('separa los consumidores listos de los incompatibles con la versión del evento', () => {
    const registry = new ConsumerRegistry([consumer('notifications', [1]), consumer('audit', [1, 2])]);
    const { ready, incompatible } = registry.consumersFor('credit.application.submitted', 2);
    expect(ready.map((c) => c.consumerId)).toEqual(['audit']);
    expect(incompatible.map((c) => c.consumerId)).toEqual(['notifications']);
  });
});
