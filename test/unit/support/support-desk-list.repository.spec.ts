import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import type { SupportChannelModel } from '../../../src/database/models/index.js';
import { SupportDeskListRepository } from '../../../src/modules/support/support-desk-list.repository.js';

/**
 * Las dos listas de la mesa: lo que se fija son las condiciones que deciden qué ve el agente. Que el
 * SQL de la búsqueda case de verdad con las columnas lo prueba la integración contra Postgres real.
 */
type Where = Record<string | symbol, unknown>;
type Consulta = { where: Where; order?: unknown[]; limit?: number; offset?: number };

describe('SupportDeskListRepository', () => {
  let channels: { findAndCountAll: jest.Mock; count: jest.Mock; min: jest.Mock };
  let repo: SupportDeskListRepository;
  const ultima = (mock: jest.Mock) => mock.mock.calls.at(-1)?.[0] as Consulta;

  beforeEach(() => {
    channels = {
      findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })),
      count: jest.fn(async () => 0),
      min: jest.fn(async () => null),
    };
    repo = new SupportDeskListRepository(channels as unknown as typeof SupportChannelModel);
  });

  describe('cola de espera', () => {
    it('atiende por orden de llegada y sólo lo que aún no tiene agente', async () => {
      await repo.listQueuedChannels('t1', null, { limit: 50, offset: 0 });

      const consulta = ultima(channels.findAndCountAll);
      expect((consulta.where.status as Record<symbol, string[]>)[Op.in]).toEqual(['REQUESTED', 'QUEUED']);
      expect(consulta.where).not.toHaveProperty('queueId');
      expect(consulta.order).toEqual([
        ['requested_at', 'ASC'],
        ['_id', 'ASC'],
      ]);
      expect(consulta.limit).toBe(50);
    });

    it('con cola, tipo de canal y página se acota y salta las filas de las páginas anteriores', async () => {
      await repo.listQueuedChannels('t1', 'q-vip', { limit: 10, offset: 20, channelType: 'CHAT' });

      const consulta = ultima(channels.findAndCountAll);
      expect(consulta.where).toMatchObject({ queueId: 'q-vip', channelType: 'CHAT' });
      expect({ limit: consulta.limit, offset: consulta.offset }).toEqual({ limit: 10, offset: 20 });
    });

    it('el texto añade UNA condición «o» sobre código, tipo y los dos ids como texto', async () => {
      await repo.listQueuedChannels('t1', null, { limit: 10, offset: 0, q: '50%' });

      const [busqueda] = ultima(channels.findAndCountAll).where[Op.and] as Array<Record<symbol, unknown[]>>;
      expect(busqueda![Op.or]).toHaveLength(4);
    });

    it('sin texto no se añade condición de búsqueda', async () => {
      await repo.listQueuedChannels('t1', null, { limit: 10, offset: 0 });
      expect(ultima(channels.findAndCountAll).where[Op.and]).toBeUndefined();
    });

    it('el resumen cuenta la cola entera: sin buscador, sin tipo y sin página', async () => {
      channels.count.mockResolvedValueOnce(9 as never).mockResolvedValueOnce(2 as never);
      channels.min.mockResolvedValueOnce(new Date('2026-09-01T10:00:00Z') as never);

      await expect(repo.summarizeQueued('t1', 'q-vip')).resolves.toEqual({
        total: 9,
        withoutCase: 2,
        oldestRequestedAt: new Date('2026-09-01T10:00:00Z'),
      });
      for (const [argumento] of channels.count.mock.calls) {
        const donde = (argumento as { where: Where }).where;
        expect(donde).toMatchObject({ tenantId: 't1', queueId: 'q-vip' });
        expect(donde[Op.and]).toBeUndefined();
      }
    });
  });

  describe('mis conversaciones', () => {
    it('sólo las vivas de ese agente, la más reciente primero', async () => {
      await repo.listAssignedChannels('t1', 'ag-1', { limit: 20, offset: 0 });

      const consulta = ultima(channels.findAndCountAll);
      expect(consulta.where).toMatchObject({ tenantId: 't1', assignedAgentProfileId: 'ag-1', deleted: false });
      expect((consulta.where.status as Record<symbol, string[]>)[Op.in]).toEqual(['OPEN', 'WAITING_USER', 'WAITING_AGENT', 'CLOSING']);
      expect(consulta.order).toEqual([
        ['last_activity_at', 'DESC'],
        ['_id', 'DESC'],
      ]);
    });

    it('un estado concreto sustituye a la lista de vivas, no se suma a ella', async () => {
      await repo.listAssignedChannels('t1', 'ag-1', { limit: 20, offset: 0, status: 'WAITING_AGENT' });
      expect(ultima(channels.findAndCountAll).where.status).toBe('WAITING_AGENT');
    });

    it('el resumen es de todas las mías, vivas, esperando mi respuesta y sin expediente', async () => {
      channels.count
        .mockResolvedValueOnce(5 as never)
        .mockResolvedValueOnce(2 as never)
        .mockResolvedValueOnce(1 as never);

      await expect(repo.summarizeAssigned('t1', 'ag-1')).resolves.toEqual({ total: 5, waitingAgent: 2, withoutCase: 1 });
      expect(channels.count.mock.calls.map(([argumento]) => (argumento as { where: Where }).where.status)).toEqual([
        { [Op.in]: ['OPEN', 'WAITING_USER', 'WAITING_AGENT', 'CLOSING'] },
        'WAITING_AGENT',
        { [Op.in]: ['OPEN', 'WAITING_USER', 'WAITING_AGENT', 'CLOSING'] },
      ]);
    });
  });
});
