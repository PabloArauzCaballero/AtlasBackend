import { describe, expect, it, jest } from '@jest/globals';
import { AuditService } from '../../../src/modules/audit/audit.service.js';

/**
 * `AuditService` pagina en memoria el feed clásico (`getCustomerAudit`) y expone la variante por
 * cursor sobre la vista `audit_event_feed` (`getCustomerAuditFeed`). Spec directo con el repo
 * mockeado: verifica el recorte de página, el mapeo de eventos y el passthrough de cursor.
 */
describe('AuditService', () => {
  function build() {
    const repository = {
      findCustomerAuditEvents: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
      findCustomerAuditEventsWithCursor: jest.fn(async (..._args: unknown[]) => ({ items: [] as unknown[], nextCursor: null })),
    };
    const service = new AuditService(repository as never);
    return { service, repository };
  }

  const evt = (eventType: string, iso: string) => ({
    eventType,
    occurredAt: new Date(iso),
    actorType: 'internal_user',
    summary: `${eventType}-summary`,
  });

  it('getCustomerAudit recorta la primera página y arma el meta de paginación', async () => {
    const { service, repository } = build();
    (repository.findCustomerAuditEvents as jest.Mock).mockResolvedValueOnce([
      evt('login', '2026-01-01T00:00:00.000Z'),
      evt('risk_eval', '2026-01-02T00:00:00.000Z'),
      evt('logout', '2026-01-03T00:00:00.000Z'),
    ] as never);
    const result = await service.getCustomerAudit('t1', { customerId: '9' } as never, { page: 1, limit: 2 } as never);
    expect(result.events).toEqual([
      { eventType: 'login', occurredAt: '2026-01-01T00:00:00.000Z', actorType: 'internal_user', summary: 'login-summary' },
      { eventType: 'risk_eval', occurredAt: '2026-01-02T00:00:00.000Z', actorType: 'internal_user', summary: 'risk_eval-summary' },
    ]);
    expect(result.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('getCustomerAudit devuelve solo el resto en la última página', async () => {
    const { service, repository } = build();
    (repository.findCustomerAuditEvents as jest.Mock).mockResolvedValueOnce([
      evt('login', '2026-01-01T00:00:00.000Z'),
      evt('risk_eval', '2026-01-02T00:00:00.000Z'),
      evt('logout', '2026-01-03T00:00:00.000Z'),
    ] as never);
    const result = await service.getCustomerAudit('t1', { customerId: '9' } as never, { page: 2, limit: 2 } as never);
    expect(result.events.map((e) => e.eventType)).toEqual(['logout']);
    expect(result.meta.totalPages).toBe(2);
  });

  it('getCustomerAuditFeed mapea las filas de la vista y propaga nextCursor', async () => {
    const { service, repository } = build();
    (repository.findCustomerAuditEventsWithCursor as jest.Mock).mockResolvedValueOnce({
      items: [
        {
          source_table: 'auth_events',
          event_type: 'login',
          occurred_at: '2026-01-01T00:00:00.000Z',
          actor_type: 'customer',
          target_type: 'session',
          target_id: 's1',
        },
      ],
      nextCursor: 'cursor-xyz',
    } as never);
    const result = await service.getCustomerAuditFeed('t1', '9', { limit: 10 });
    expect(result.events).toEqual([
      {
        sourceTable: 'auth_events',
        eventType: 'login',
        occurredAt: '2026-01-01T00:00:00.000Z',
        actorType: 'customer',
        targetType: 'session',
        targetId: 's1',
      },
    ]);
    expect(result.nextCursor).toBe('cursor-xyz');
  });
});
