/**
 * @file Suite de contrato del puerto `TransactionalOutbox` (AT-051): la corre el doble y el adaptador real.
 * @business Lo que el caso de uso puede asumir del outbox es exactamente esto, con doble o con base:
 *   identidad devuelta, sobre validado, claves prohibidas rechazadas, deduplicación por clave.
 * @system Función `describe` parametrizada por una fábrica; el adaptador Sequelize la ejecuta en
 *   `test/integration/architecture/port-substitution-sequelize.spec.ts` dentro de una transacción
 *   que se revierte. Un doble que acepte lo que la base rechaza rompe aquí, no en producción.
 */
import { describe, expect, it } from '@jest/globals';
import type { OutboxAppend, TransactionalOutbox } from '../../../src/platform/events/transactional-outbox.port.js';

export type OutboxFactory = () => Promise<{ outbox: TransactionalOutbox; dispose: () => Promise<void> }>;

export const OUTBOX_CONTRACT_CASES = [
  'devuelve eventId (uuid) y outboxRowId',
  'rechaza una clave de payload prohibida (EVENT_FORBIDDEN_PAYLOAD_KEY)',
  'rechaza un ámbito tenant sin tenantId (EVENT_INVALID_SCOPE)',
  'rechaza el mismo dedupKey dos veces para el mismo ámbito y tipo',
  'admite el mismo dedupKey para otro tipo de evento',
] as const;

export function baseEvent(overrides: Partial<OutboxAppend> = {}): OutboxAppend {
  return {
    type: 'credit.application.submitted',
    scope: { kind: 'tenant', tenantId: '1' },
    aggregate: { type: 'credit_application', id: '1', version: 1 },
    producer: 'contract-test',
    payload: { applicationCode: 'CRA-1' },
    ...overrides,
  };
}

export function describeTransactionalOutboxContract(name: string, factory: OutboxFactory, tenantId = '1'): void {
  describe(`contrato TransactionalOutbox · ${name}`, () => {
    const withOutbox = async (run: (outbox: TransactionalOutbox) => Promise<void>) => {
      const { outbox, dispose } = await factory();
      try {
        await run(outbox);
      } finally {
        await dispose();
      }
    };
    const scoped = (overrides: Partial<OutboxAppend> = {}) => baseEvent({ scope: { kind: 'tenant', tenantId }, ...overrides });

    it(OUTBOX_CONTRACT_CASES[0], () =>
      withOutbox(async (outbox) => {
        const appended = await outbox.append(scoped());
        expect(appended.eventId).toMatch(/^[0-9a-f-]{36}$/);
        expect(appended.outboxRowId).toMatch(/^\d+$/);
      }),
    );

    it(OUTBOX_CONTRACT_CASES[1], () =>
      withOutbox(async (outbox) => {
        await expect(outbox.append(scoped({ payload: { documentNumber: '123' } }))).rejects.toMatchObject({
          code: 'EVENT_FORBIDDEN_PAYLOAD_KEY',
        });
      }),
    );

    it(OUTBOX_CONTRACT_CASES[2], () =>
      withOutbox(async (outbox) => {
        await expect(outbox.append(baseEvent({ scope: { kind: 'tenant', tenantId: '' } }))).rejects.toMatchObject({
          code: 'EVENT_INVALID_SCOPE',
        });
      }),
    );

    it(OUTBOX_CONTRACT_CASES[3], () =>
      withOutbox(async (outbox) => {
        const dedupKey = `dedup-${Date.now()}`;
        await outbox.append(scoped({ dedupKey }));
        // `toBeDefined()` aceptaba cualquier error, incluido uno de conexión (revisión independiente B,
        // hallazgo 9). El rechazo tiene que venir del DUPLICADO: código de negocio en el doble, o
        // `SequelizeUniqueConstraintError` (índice `ux_outbox_tenant_event_idempotency_key`) en PostgreSQL,
        // cuyo `message` es el genérico «Validation error» y por eso se mira el nombre del error.
        const duplicate = await outbox
          .append(scoped({ dedupKey, aggregate: { type: 'credit_application', id: '2', version: 1 } }))
          .then(() => null)
          .catch((error: unknown) => error);
        expect(duplicate).not.toBeNull();
        const signature = `${(duplicate as { name?: string })?.name ?? ''}|${(duplicate as { code?: string })?.code ?? ''}`;
        expect(signature).toMatch(/UniqueConstraint|OUTBOX_DEDUP_KEY_TAKEN/i);
      }),
    );

    it(OUTBOX_CONTRACT_CASES[4], () =>
      withOutbox(async (outbox) => {
        const dedupKey = `dedup-other-${Date.now()}`;
        await outbox.append(scoped({ dedupKey }));
        await expect(outbox.append(scoped({ dedupKey, type: 'credit.application.decided' }))).resolves.toBeDefined();
      }),
    );
  });
}
