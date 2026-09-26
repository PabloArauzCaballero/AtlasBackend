import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportMessageRepository } from '../../../src/modules/support/support-message.repository.js';
import { messageIntegrityHash } from '../../../src/modules/support/domain/support-hash-chain.js';
import type { SupportAttachmentModel, SupportMessageModel, SupportMessageRelationModel } from '../../../src/database/models/index.js';

/**
 * El apéndice de mensajes: la operación más delicada del módulo.
 *
 * Tres decisiones se fijan aquí y las tres se rompen sin error visible. La secuencia se reserva con
 * un `UPDATE ... RETURNING` que bloquea la fila del canal, no con un COUNT: contar primero y
 * escribir después da a dos mensajes simultáneos el mismo número, y el índice único hace fallar a
 * uno de los dos con algo que el usuario lee como «no se pudo enviar». El hash anterior se lee
 * DENTRO de la misma transacción, porque leerlo fuera deja dos mensajes apuntando al mismo padre y
 * la verificación denuncia manipulación donde sólo hubo concurrencia. Y un `clientMessageId`
 * repetido devuelve el mensaje que ya está: reintentar por mala red es lo normal en un móvil,
 * duplicar la pregunta del cliente no.
 *
 * Se fija además que la paginación hacia adelante ordene ASC. Con DESC, «dame lo nuevo» devuelve
 * los últimos N y no los N SIGUIENTES: un cliente que estuvo desconectado se salta lo del medio sin
 * enterarse.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock };

function doble(): Doble {
  return { create: jest.fn(async (values: unknown) => values), findOne: jest.fn(async () => null), findAll: jest.fn(async () => []) };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; order?: unknown[]; limit?: number; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

const ENTRADA = {
  tenantId: 't1',
  channelId: 'ch-1',
  clientMessageId: 'uuid-1',
  senderActorType: 'customer',
  senderActorId: '42',
  senderAgentProfileId: null,
  messageType: 'TEXT',
  visibility: 'PUBLIC',
  bodyText: 'Hola',
  bodyCiphertext: null,
  keyVersion: null,
  classification: 'NORMAL',
  originalBody: 'Hola',
  redactionReason: null,
  correlationId: null,
  metadata: null,
};

describe('SupportMessageRepository', () => {
  let query: jest.Mock;
  let messages: Doble;
  let relations: Doble;
  let attachments: Doble;
  let repo: SupportMessageRepository;
  const tx = {} as never;

  beforeEach(() => {
    query = jest.fn(async () => [{ last_message_sequence: '5', last_message_hash: 'hash-4' }]);
    messages = doble();
    relations = doble();
    attachments = doble();
    repo = new SupportMessageRepository(
      { query } as unknown as Sequelize,
      messages as unknown as typeof SupportMessageModel,
      relations as unknown as typeof SupportMessageRelationModel,
      attachments as unknown as typeof SupportAttachmentModel,
    );
  });

  describe('añadir un mensaje', () => {
    it('reserva la secuencia con un UPDATE sobre el canal, no contando filas', async () => {
      await repo.append(ENTRADA, tx);

      const [sql, opciones] = query.mock.calls[0] as [string, { replacements: Record<string, unknown>; transaction: unknown }];
      expect(sql).toContain('SET last_message_sequence = last_message_sequence + 1');
      expect(sql).toContain('RETURNING last_message_sequence, last_message_hash');
      expect(opciones.replacements).toMatchObject({ tenantId: 't1', channelId: 'ch-1' });
      expect(opciones.transaction).toBe(tx);
    });

    it('el mensaje nace con la secuencia reservada y encadenado al hash anterior', async () => {
      const { message, created } = await repo.append(ENTRADA, tx);
      const escrito = message as unknown as Record<string, unknown>;

      expect(created).toBe(true);
      expect(escrito.serverSequence).toBe('5');
      expect(escrito.previousMessageHash).toBe('hash-4');
      expect(escrito.integrityHash).toEqual(
        messageIntegrityHash({
          channelId: 'ch-1',
          serverSequence: '5',
          senderActorType: 'customer',
          senderActorId: '42',
          createdAtIso: (escrito.createdAtValue as Date).toISOString(),
          contentHash: escrito.contentHash as string,
          previousMessageHash: 'hash-4',
        }),
      );
    });

    it('el primer mensaje del canal encadena a nulo y no a una cadena vacía', async () => {
      query.mockResolvedValueOnce([{ last_message_sequence: '1', last_message_hash: null }] as never);

      const { message } = await repo.append(ENTRADA, tx);

      expect((message as unknown as Record<string, unknown>).previousMessageHash).toBeNull();
    });

    it('el hash de contenido se calcula sobre el ORIGINAL, aunque el cuerpo salga redactado', async () => {
      const conRedaccion = await repo.append(
        { ...ENTRADA, bodyText: '[redactado]', originalBody: 'Mi CI es 123', redactionReason: 'PII' },
        tx,
      );
      const sinRedaccion = await repo.append(
        { ...ENTRADA, clientMessageId: 'uuid-2', bodyText: 'Mi CI es 123', originalBody: 'Mi CI es 123' },
        tx,
      );

      const a = conRedaccion.message as unknown as Record<string, unknown>;
      const b = sinRedaccion.message as unknown as Record<string, unknown>;
      expect(a.contentHash).toBe(b.contentHash);
      expect(a.redactedAt).toBeInstanceOf(Date);
      expect(b.redactedAt).toBeNull();
    });

    it('deja el hash del último mensaje en el canal para que el siguiente encadene', async () => {
      const { message } = await repo.append(ENTRADA, tx);

      const [sql, opciones] = query.mock.calls.at(-1) as [string, { replacements: Record<string, unknown> }];
      expect(sql).toContain('SET last_message_hash = :hash');
      expect(opciones.replacements.hash).toBe((message as unknown as Record<string, unknown>).integrityHash);
    });

    it('un `clientMessageId` repetido devuelve el que ya está y no reserva secuencia', async () => {
      const yaEstaba = { id: 9 } as unknown as SupportMessageModel;
      messages.findOne.mockResolvedValueOnce(yaEstaba as never);

      const resultado = await repo.append(ENTRADA, tx);

      expect(resultado).toEqual({ message: yaEstaba, created: false });
      expect(query).not.toHaveBeenCalled();
      expect(messages.create).not.toHaveBeenCalled();
    });

    it('un canal que no existe falla en vez de escribir un mensaje huérfano', async () => {
      query.mockResolvedValueOnce([] as never);

      await expect(repo.append(ENTRADA, tx)).rejects.toThrow('SUPPORT_CHANNEL_NOT_FOUND');
      expect(messages.create).not.toHaveBeenCalled();
    });
  });

  describe('transcripción', () => {
    it('hacia atrás es historial: DESC y por cursor, nunca por OFFSET', async () => {
      await repo.listMessages({ channelId: 'ch-1', beforeSequence: '100', limit: 50, includeInternal: true });

      expect((ultima(messages.findAll).where.serverSequence as Record<symbol, string>)[Op.lt]).toBe('100');
      expect(ultima(messages.findAll).order).toEqual([['server_sequence', 'DESC']]);
      expect(ultima(messages.findAll).limit).toBe(50);
    });

    it('hacia adelante es ASC: si no, «lo nuevo» son los últimos N y no los N siguientes', async () => {
      await repo.listMessages({ channelId: 'ch-1', afterSequence: '100', limit: 50, includeInternal: true });

      expect((ultima(messages.findAll).where.serverSequence as Record<symbol, string>)[Op.gt]).toBe('100');
      expect(ultima(messages.findAll).order).toEqual([['server_sequence', 'ASC']]);
    });

    it('sin permiso interno sólo salen los mensajes públicos y de sistema', async () => {
      await repo.listMessages({ channelId: 'ch-1', limit: 50, includeInternal: false });

      expect((ultima(messages.findAll).where.visibility as Record<symbol, string[]>)[Op.in]).toEqual(['PUBLIC', 'SYSTEM']);
    });

    it('con permiso interno no se filtra la visibilidad', async () => {
      await repo.listMessages({ channelId: 'ch-1', limit: 50, includeInternal: true });

      expect(ultima(messages.findAll).where).not.toHaveProperty('visibility');
    });

    it('un mensaje por id exige el tenant', async () => {
      await repo.findById('t1', 'm-1');
      expect(ultima(messages.findOne).where).toEqual({ tenantId: 't1', id: 'm-1' });
    });
  });

  describe('relaciones y adjuntos', () => {
    it('las relaciones se leen por los dos extremos', async () => {
      await repo.listRelations(['m-1', 'm-2']);

      const [porOrigen, porDestino] = ultima(relations.findAll).where[Op.or] as Array<Record<string, Record<symbol, string[]>>>;
      expect(porOrigen.messageId[Op.in]).toEqual(['m-1', 'm-2']);
      expect(porDestino.relatedMessageId[Op.in]).toEqual(['m-1', 'm-2']);
    });

    it('sin mensajes no se consulta: un `IN ()` vacío traería todo el tenant', async () => {
      await expect(repo.listRelations([])).resolves.toEqual([]);
      await expect(repo.listAttachments([])).resolves.toEqual([]);
      expect(relations.findAll).not.toHaveBeenCalled();
      expect(attachments.findAll).not.toHaveBeenCalled();
    });

    it('los adjuntos se piden en bloque para los mensajes de la página', async () => {
      await repo.listAttachments(['m-1', 'm-2']);

      expect((ultima(attachments.findAll).where.messageId as Record<symbol, string[]>)[Op.in]).toEqual(['m-1', 'm-2']);
    });

    it('crear relación y adjunto propaga la transacción, y un adjunto por id exige el tenant', async () => {
      await repo.createRelation({ messageId: 'm-1' } as never, { transaction: tx });
      expect(relations.create).toHaveBeenCalledWith({ messageId: 'm-1' }, { transaction: tx });

      await repo.createAttachment({ messageId: 'm-1' } as never, { transaction: tx });
      expect(attachments.create).toHaveBeenCalledWith({ messageId: 'm-1' }, { transaction: tx });

      await repo.findAttachmentById('t1', 'a-1');
      expect(ultima(attachments.findOne).where).toEqual({ tenantId: 't1', id: 'a-1' });
    });

    it('encontrar por identificador de cliente acota al canal: dos canales pueden repetir el uuid', async () => {
      await repo.findByClientId('ch-1', 'uuid-1');

      expect(ultima(messages.findOne).where).toEqual({ channelId: 'ch-1', clientMessageId: 'uuid-1' });
    });
  });

  describe('verificación de la cadena', () => {
    function eslabon(secuencia: string, anterior: string | null) {
      const createdAt = new Date(`2026-09-0${secuencia}T10:00:00Z`);
      const contentHash = `c-${secuencia}`;
      return {
        channelId: 'ch-1',
        serverSequence: secuencia,
        senderActorType: 'customer',
        senderActorId: '42',
        createdAtValue: createdAt,
        contentHash,
        previousMessageHash: anterior,
        integrityHash: messageIntegrityHash({
          channelId: 'ch-1',
          serverSequence: secuencia,
          senderActorType: 'customer',
          senderActorId: '42',
          createdAtIso: createdAt.toISOString(),
          contentHash,
          previousMessageHash: anterior,
        }),
      };
    }

    it('una cadena coherente se recalcula y sale válida', async () => {
      const uno = eslabon('1', null);
      const dos = eslabon('2', uno.integrityHash);
      messages.findAll.mockResolvedValueOnce([uno, dos] as never);

      await expect(repo.verifyChannelChain('ch-1')).resolves.toMatchObject({ valid: true });
      expect(ultima(messages.findAll).order).toEqual([['server_sequence', 'ASC']]);
    });

    it('un mensaje reescrito en la base sorteando los disparadores sale denunciado', async () => {
      const uno = eslabon('1', null);
      const dos = { ...eslabon('2', uno.integrityHash), contentHash: 'c-manipulado' };
      messages.findAll.mockResolvedValueOnce([uno, dos] as never);

      const resultado = await repo.verifyChannelChain('ch-1');

      expect(resultado.valid).toBe(false);
    });
  });
});
