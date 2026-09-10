import { Op } from 'sequelize';
import { countOutboxBacklog, OUTBOX_SIN_INQUILINO, publishOutboxBacklog } from '../../../src/modules/runtime-jobs/outbox-backlog.js';

/**
 * El indicador de backlog del outbox es el que tendría que haber delatado tres semanas de eventos
 * sin inquilino que nadie recogía. Cuando el consumidor empezó a tomarlos, las cuentas siguieron
 * siendo sólo del inquilino, así que el indicador seguía sin verlos: se drenaban, pero no se medían.
 */
describe('countOutboxBacklog', () => {
  it('cuenta aparte los del inquilino y los sin inquilino, las dos poblaciones que toma el consumidor', async () => {
    const where: Array<Record<string | symbol, unknown>> = [];
    const outbox = {
      count: jest.fn(async (options: unknown) => {
        const w = (options as { where: Record<string | symbol, unknown> }).where;
        where.push(w);
        return w.tenantId === null ? 3 : 8;
      }),
    };

    await expect(countOutboxBacklog(outbox, '1')).resolves.toEqual({ tenant: 8, withoutTenant: 3 });
    expect(where.map((w) => w.tenantId)).toEqual(['1', null]);
    // Sólo lo disponible y pendiente, igual que la reclamación: si no, se medirían cosas distintas.
    for (const w of where) {
      expect(w.status).toBe('pending');
      expect((w.availableAt as Record<symbol, unknown>)[Op.lte]).toBeInstanceOf(Date);
    }
  });
});

describe('publishOutboxBacklog', () => {
  it('publica la serie del inquilino y UNA serie sin inquilino', () => {
    const series = new Map<string, number>();
    const metrics = {
      setOutboxPendingEvents: ({ tenantId, pending }: { tenantId: string; pending: number }) => series.set(tenantId, pending),
    };

    publishOutboxBacklog(metrics, '1', { tenant: 8, withoutTenant: 3 });

    expect(series.get('1')).toBe(8);
    expect(series.get(OUTBOX_SIN_INQUILINO)).toBe(3);
  });

  it('con varios inquilinos, los sin inquilino NO se multiplican: el gauge se fija, no se suma', () => {
    // Sumarlos a la serie de cada inquilino los habría contado N veces con N inquilinos.
    const series = new Map<string, number>();
    const metrics = {
      setOutboxPendingEvents: ({ tenantId, pending }: { tenantId: string; pending: number }) => series.set(tenantId, pending),
    };

    publishOutboxBacklog(metrics, '1', { tenant: 8, withoutTenant: 3 });
    publishOutboxBacklog(metrics, '2', { tenant: 5, withoutTenant: 3 });

    const total = [...series.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(8 + 5 + 3);
  });

  it('sin métricas inyectadas no revienta: el consumidor tiene que seguir drenando igual', () => {
    expect(() => publishOutboxBacklog(undefined, '1', { tenant: 1, withoutTenant: 1 })).not.toThrow();
  });
});
