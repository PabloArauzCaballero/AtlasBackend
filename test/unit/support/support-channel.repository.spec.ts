import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';
import type { SupportChannelModel, SupportChannelParticipantModel } from '../../../src/database/models/index.js';

/**
 * El canal de atención y quién está dentro.
 *
 * Lo que se fija son las condiciones que deciden quién puede leer una conversación y qué se ve como
 * pendiente. Son todas silenciosas: una participación que no filtra por `leftAt` deja a un agente
 * apartado del caso leyendo el transcript; un acuse de lectura que no usa `GREATEST` hace
 * reaparecer como «sin leer» lo que la persona ya vio en cuanto un ack llega fuera de orden; y un
 * doble tic que no se excluye a sí mismo enseña al remitente su propio puntero como si fuera el del
 * otro.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock; update: jest.Mock };

function doble(): Doble {
  return {
    create: jest.fn(async () => ({ id: 'x' })),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => []),
    update: jest.fn(async () => [0]),
  };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; order?: unknown[]; limit?: number; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

const VIVOS = ['REQUESTED', 'QUEUED', 'OPEN', 'WAITING_USER', 'WAITING_AGENT'];

describe('SupportChannelRepository', () => {
  let query: jest.Mock;
  let channels: Doble;
  let participants: Doble;
  let repo: SupportChannelRepository;
  const tx = {} as never;

  beforeEach(() => {
    query = jest.fn(async () => []);
    channels = doble();
    participants = doble();
    repo = new SupportChannelRepository(
      { query } as unknown as Sequelize,
      channels as unknown as typeof SupportChannelModel,
      participants as unknown as typeof SupportChannelParticipantModel,
    );
  });

  describe('canal', () => {
    it('leer un canal exige tenant y descarta el borrado', async () => {
      await repo.findById('t1', 'ch-1');
      expect(ultima(channels.findOne).where).toEqual({ tenantId: 't1', id: 'ch-1', deleted: false });
    });

    it('exigirlo cuando no existe es 404 con el código del dominio, no un 500', async () => {
      channels.findOne.mockResolvedValueOnce(null as never);
      await expect(repo.requireById('t1', 'ch-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('exigirlo cuando existe lo devuelve tal cual', async () => {
      const canal = { id: 'ch-1' } as never;
      channels.findOne.mockResolvedValueOnce(canal);
      await expect(repo.requireById('t1', 'ch-1')).resolves.toBe(canal);
    });

    it('crear y actualizar propagan la transacción, y actualizar sella `updated_at`', async () => {
      await repo.create({ tenantId: 't1' } as never, { transaction: tx });
      expect(channels.create).toHaveBeenCalledWith({ tenantId: 't1' }, { transaction: tx });

      await repo.update('t1', 'ch-1', { status: 'CLOSED' } as never, { transaction: tx });
      const [values, opciones] = channels.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown; transaction: unknown }];
      expect(values.updatedAtValue).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'ch-1' });
      expect(opciones.transaction).toBe(tx);
    });
  });

  describe('reutilizar el canal vivo', () => {
    it('el del cliente se busca entre los estados vivos y devuelve el más reciente', async () => {
      await repo.findLiveChannelForCustomer('t1', 'c1');

      const condicion = ultima(channels.findOne).where;
      expect(condicion.subjectCustomerId).toBe('c1');
      expect(condicion.deleted).toBe(false);
      expect((condicion.status as Record<symbol, string[]>)[Op.in]).toEqual(VIVOS);
      expect(ultima(channels.findOne).order).toEqual([['requested_at', 'DESC']]);
    });

    it('el del empleado del comercio sale de SU participación, no del comercio entero', async () => {
      participants.findAll.mockResolvedValueOnce([{ channelId: 'ch-7' }, { channelId: 'ch-8' }] as never);

      await repo.findLiveChannelForPartnerUser('t1', 'pp-1', 'u-42');

      expect(ultima(participants.findAll).where).toEqual({ tenantId: 't1', actorId: 'u-42', roleInChannel: 'REQUESTER', leftAt: null });
      const condicion = ultima(channels.findOne).where;
      expect(condicion.subjectPartnerProfileId).toBe('pp-1');
      expect((condicion.id as Record<symbol, string[]>)[Op.in]).toEqual(['ch-7', 'ch-8']);
    });

    it('sin participación viva no se consulta el canal: dos empleados del mismo comercio no comparten conversación', async () => {
      participants.findAll.mockResolvedValueOnce([] as never);

      await expect(repo.findLiveChannelForPartnerUser('t1', 'pp-1', 'u-42')).resolves.toBeNull();
      expect(channels.findOne).not.toHaveBeenCalled();
    });
  });

  describe('cola y listados', () => {
    it('la cola atiende por orden de llegada y sólo lo que aún no tiene agente', async () => {
      await repo.listQueuedChannels('t1', null);

      const condicion = ultima(channels.findAll).where;
      expect((condicion.status as Record<symbol, string[]>)[Op.in]).toEqual(['REQUESTED', 'QUEUED']);
      expect(condicion).not.toHaveProperty('queueId');
      expect(ultima(channels.findAll).order).toEqual([['requested_at', 'ASC']]);
      expect(ultima(channels.findAll).limit).toBe(50);
    });

    it('con cola indicada se acota a esa cola', async () => {
      await repo.listQueuedChannels('t1', 'q-vip', 10);

      expect(ultima(channels.findAll).where.queueId).toBe('q-vip');
      expect(ultima(channels.findAll).limit).toBe(10);
    });

    it('los canales de un caso salen del más reciente al más viejo y sin los borrados', async () => {
      await repo.listChannelsForCase('caso-1');

      expect(ultima(channels.findAll).where).toEqual({ caseId: 'caso-1', deleted: false });
      expect(ultima(channels.findAll).order).toEqual([['requested_at', 'DESC']]);
    });
  });

  describe('participantes', () => {
    it('la autorización mira la participación VIVA, no el rol del token', async () => {
      await repo.findLiveParticipant('ch-1', 'internal_user', '7');

      expect(ultima(participants.findOne).where).toEqual({ channelId: 'ch-1', actorType: 'internal_user', actorId: '7', leftAt: null });
    });

    it('salir escribe el motivo y sólo alcanza a la participación viva', async () => {
      await repo.removeParticipant('ch-1', 'internal_user', '7', 'TRANSFER', { transaction: tx });

      const [values, opciones] = participants.update.mock.calls.at(-1) as [Record<string, unknown>, { where: Record<string, unknown> }];
      expect(values.leaveReason).toBe('TRANSFER');
      expect(values.leftAt).toBeInstanceOf(Date);
      expect(opciones.where.leftAt).toBeNull();
    });

    it('añadir y listar participantes propagan la transacción, y la lista va por orden de entrada', async () => {
      await repo.addParticipant({ channelId: 'ch-1' } as never, { transaction: tx });
      expect(participants.create).toHaveBeenCalledWith({ channelId: 'ch-1' }, { transaction: tx });

      await repo.listParticipants('ch-1', { transaction: tx });
      expect(ultima(participants.findAll).order).toEqual([['joined_at', 'ASC']]);
      expect(ultima(participants.findAll).transaction).toBe(tx);
    });
  });

  describe('acuses de lectura', () => {
    it('el puntero sólo avanza: un acuse viejo no reabre como «sin leer» lo ya visto', async () => {
      await repo.markRead({ channelId: 'ch-1', actorType: 'customer', actorId: '42', upToSequence: '17' });

      const [values] = participants.update.mock.calls.at(-1) as [Record<string, { val?: string }>];
      expect(String(values.lastReadSequence.val)).toBe('GREATEST(last_read_sequence, 17)');
    });

    it('una secuencia que no es número cae a 0 en vez de inyectarse en el SQL', async () => {
      await repo.markRead({ channelId: 'ch-1', actorType: 'customer', actorId: '42', upToSequence: '1); DROP TABLE x;--' });

      const [values] = participants.update.mock.calls.at(-1) as [Record<string, { val?: string }>];
      expect(String(values.lastReadSequence.val)).toBe('GREATEST(last_read_sequence, 0)');
    });

    it('marcar visto no toca los punteros de lectura, sólo la presencia', async () => {
      await repo.touchSeen('ch-1', 'customer', '42');

      const [values, opciones] = participants.update.mock.calls.at(-1) as [Record<string, unknown>, { where: Record<string, unknown> }];
      expect(Object.keys(values)).toEqual(['lastSeenAt']);
      expect(opciones.where.leftAt).toBeNull();
    });

    it('el doble tic excluye al que pregunta: su propio puntero no le dice si el otro lo vio', async () => {
      participants.findAll.mockResolvedValueOnce([
        { actorType: 'customer', actorId: '42', roleInChannel: 'REQUESTER', lastReadSequence: 9, lastReadAt: null, lastSeenAt: null },
        {
          actorType: 'internal_user',
          actorId: '7',
          roleInChannel: 'AGENT',
          lastReadSequence: 12,
          lastReadAt: new Date('2026-09-10T10:00:00Z'),
          lastSeenAt: new Date('2026-09-10T10:05:00Z'),
        },
      ] as never);

      const estado = await repo.readStateOf('ch-1', 'customer', '42');

      expect(estado).toEqual([
        {
          actorType: 'internal_user',
          roleInChannel: 'AGENT',
          lastReadSequence: '12',
          lastReadAt: '2026-09-10T10:00:00.000Z',
          lastSeenAt: '2026-09-10T10:05:00.000Z',
        },
      ]);
    });

    it('quien no ha leído nada se reporta como «0» y no como nulo', async () => {
      participants.findAll.mockResolvedValueOnce([
        { actorType: 'internal_user', actorId: '7', roleInChannel: 'AGENT', lastReadSequence: null, lastReadAt: null, lastSeenAt: null },
      ] as never);

      const estado = await repo.readStateOf('ch-1', 'customer', '42');
      expect(estado[0].lastReadSequence).toBe('0');
    });
  });

  describe('sin leer por conversación', () => {
    it('la cifra es una resta contra el contador del canal y viaja parametrizada', async () => {
      query.mockResolvedValueOnce([{ channel_id: 'ch-1', unread: '3', last_message_sequence: '20' }] as never);

      const resultado = await repo.unreadByChannel({ tenantId: 't1', actorType: 'customer', actorId: '42', publicOnly: true });

      expect(resultado).toEqual([{ channelId: 'ch-1', unread: 3, lastMessageSequence: '20' }]);
      const [sql, opciones] = query.mock.calls.at(-1) as [string, { replacements: Record<string, unknown> }];
      expect(opciones.replacements).toEqual({ tenantId: 't1', actorType: 'customer', actorId: '42', publicOnly: true });
      expect(sql).not.toContain("'42'");
    });

    it('los mensajes internos y los propios no cuentan como pendientes del cliente', async () => {
      await repo.unreadByChannel({ tenantId: 't1', actorType: 'customer', actorId: '42', publicOnly: true });

      const [sql] = query.mock.calls.at(-1) as [string];
      expect(sql).toContain(":publicOnly = FALSE OR m.visibility <> 'INTERNAL'");
      expect(sql).toContain('NOT (m.sender_actor_type = :actorType AND m.sender_actor_id = :actorId)');
    });
  });
});
