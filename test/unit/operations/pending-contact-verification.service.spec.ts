import { describe, expect, it, jest } from '@jest/globals';
import { PendingContactVerificationService } from '../../../src/modules/operations/pending-contact-verification.service.js';

/**
 * La cola de contactos sin verificar, por páginas. El SQL se prueba contra PostgreSQL real en
 * `test/integration/operations/list-search.spec.ts`; aquí, qué filtros se arman y cómo se responde.
 */
describe('PendingContactVerificationService', () => {
  const creado = new Date('2026-09-14T10:00:00Z');

  function build() {
    const query = jest.fn(async (sql: string, _options?: unknown): Promise<unknown[]> => {
      if (sql.includes('FILTER')) return [{ total: '250', email: '180', phone: '70' }];
      if (sql.includes('COUNT(*)')) return [{ total: '31' }];
      return [
        {
          customerId: '21',
          customerCode: 'CUS-21',
          lifecycleStatus: 'under_review',
          customerCreatedAt: creado,
          contactMethodId: '501',
          contactType: 'email',
          valueLast4: 'l.bo',
          emailDomain: 'upsa.edu.bo',
          isPrimary: true,
          contactCreatedAt: creado,
        },
      ];
    });
    return { query, service: new PendingContactVerificationService({ query } as never) };
  }

  it('pagina en el servidor y trae meta con el total real, no un tope oculto de 200', async () => {
    const { service, query } = build();
    const result = await service.list('1', { page: 2, limit: 10 });

    expect(result.meta).toEqual({ page: 2, limit: 10, total: 31, totalPages: 4 });
    const pagina = query.mock.calls.find(([sql]) => sql.includes('LIMIT'));
    expect((pagina?.[1] as { bind: Record<string, unknown> }).bind).toMatchObject({ tenantId: '1', limit: 10, offset: 10 });
    expect(result.items[0]).toMatchObject({ customerCode: 'CUS-21', contactCreatedAt: creado.toISOString() });
  });

  it('las tarjetas salen de un COUNT de toda la cola, no de la página', async () => {
    const { service } = build();
    const result = await service.list('1', { page: 1, limit: 25 });
    expect(result.summary).toEqual({ total: 250, email: 180, phone: 70 });
  });

  it('q busca por código de cliente, dominio y últimos 4 (escapando comodines) y contactType filtra el tipo', async () => {
    const { service, query } = build();
    await service.list('1', { page: 1, limit: 25, q: '50%_x', contactType: 'phone' });
    const pagina = query.mock.calls.find(([sql]) => sql.includes('LIMIT'));
    const [sql, options] = pagina as [string, { bind: Record<string, unknown> }];
    expect(sql).toContain('c.customer_code ILIKE $q OR cm.email_domain ILIKE $q OR cm.value_last_4 ILIKE $q');
    expect(sql).toContain('cm.contact_type = $contactType');
    expect(options.bind).toMatchObject({ q: '%50\\%\\_x%', contactType: 'phone' });
    // El resumen NO lleva los filtros: es de toda la cola.
    const resumen = query.mock.calls.find(([s]) => s.includes('FILTER'));
    expect(resumen?.[0]).not.toContain('$q');
  });
});
