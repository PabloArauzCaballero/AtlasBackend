import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { firstValueFrom, of, toArray } from 'rxjs';
import { SupportChatController } from '../../../src/modules/support/support-chat.controller.js';
import type { SupportActorService } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportChannelService } from '../../../src/modules/support/application/support-channel.service.js';
import type { SupportMessageService } from '../../../src/modules/support/application/support-message.service.js';
import type { SupportConversationService } from '../../../src/modules/support/application/support-conversation.service.js';
import type { SupportRealtimeService } from '../../../src/modules/support/application/support-realtime.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * La conversación de soporte.
 *
 * Lo que se fija de verdad es el hilo en vivo, que es el único sitio del módulo donde el control de
 * privacidad vive en el CONTROLADOR y no en un servicio. Las notas internas se filtran del stream
 * según quién escucha y NUNCA según un parámetro: si el filtro se cayera, un cliente con la
 * conversación abierta recibiría en tiempo real lo que el agente escribe para sus compañeros —y sin
 * que nada fallara, porque el evento llega igual de bien—. Y que antes de suscribir se compruebe
 * que quien pide participa en el canal: sin eso, cualquiera con un `channelId` escucharía la
 * conversación de otro.
 *
 * Lo demás es cableado, y el cableado de este controlador tampoco puede verse desde abajo: enviar,
 * corregir, cerrar y marcar leído reparten entre cuatro servicios distintos y un cruce entre dos de
 * ellos responde 200 con el efecto equivocado.
 */
const CLIENTE = { role: 'customer', tenantId: 't1', customerId: '42' } as AuthenticatedUser;
const ACTOR_CLIENTE = { tipo: 'customer', id: '42', isInternal: false } as never;
const ACTOR_AGENTE = { tipo: 'internal_user', id: '7', isInternal: true } as never;

function evento(visibility: string, tipo = 'message.created') {
  return { type: tipo, data: { visibility, body: `mensaje ${visibility}` } };
}

describe('SupportChatController', () => {
  let actors: { resolve: jest.Mock };
  let channels: { requestChannel: jest.Mock; closeChannel: jest.Mock };
  let messages: { send: jest.Mock; assertParticipates: jest.Mock };
  let conversation: { transcript: jest.Mock; correct: jest.Mock; markRead: jest.Mock; announceTyping: jest.Mock; unread: jest.Mock };
  let realtime: { sseFor: jest.Mock };
  let controller: SupportChatController;

  beforeEach(() => {
    actors = { resolve: jest.fn(async () => ACTOR_CLIENTE) };
    channels = { requestChannel: jest.fn(async () => 'canal-abierto'), closeChannel: jest.fn(async () => 'canal-cerrado') };
    messages = { send: jest.fn(async () => 'enviado'), assertParticipates: jest.fn(async () => undefined) };
    conversation = {
      transcript: jest.fn(async () => 'transcripcion'),
      correct: jest.fn(async () => 'corregido'),
      markRead: jest.fn(async () => 'leido'),
      announceTyping: jest.fn(async () => undefined),
      unread: jest.fn(async () => 'sin-leer'),
    };
    realtime = { sseFor: jest.fn(() => of(evento('PUBLIC'))) };
    controller = new SupportChatController(
      actors as unknown as SupportActorService,
      channels as unknown as SupportChannelService,
      messages as unknown as SupportMessageService,
      conversation as unknown as SupportConversationService,
      realtime as unknown as SupportRealtimeService,
    );
  });

  describe('cableado', () => {
    it('abrir canal va al servicio de canales con el actor resuelto', async () => {
      await expect(controller.open('t1', { subject: 'pago' } as never, CLIENTE)).resolves.toBe('canal-abierto');

      expect(actors.resolve).toHaveBeenCalledWith(CLIENTE, 't1');
      expect(channels.requestChannel).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR_CLIENTE, dto: { subject: 'pago' } });
    });

    it('enviar propaga la correlación cuando llega y la declara nula cuando no', async () => {
      await controller.send('t1', 'corr-1', 'ch-1', { body: 'hola' } as never, CLIENTE);
      expect(messages.send).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: 'ch-1', correlationId: 'corr-1' }));

      await controller.send('t1', undefined, 'ch-1', { body: 'hola' } as never, CLIENTE);
      expect(messages.send).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: null }));
    });

    it('la transcripción pasa la consulta entera: la paginación es por secuencia, no por offset', async () => {
      await expect(controller.transcript('t1', 'ch-1', { beforeSequence: '100', limit: 50 } as never, CLIENTE)).resolves.toBe(
        'transcripcion',
      );

      expect(conversation.transcript).toHaveBeenCalledWith({
        tenantId: 't1',
        actor: ACTOR_CLIENTE,
        channelId: 'ch-1',
        query: { beforeSequence: '100', limit: 50 },
      });
    });

    it('corregir crea un mensaje enlazado y lleva los DOS identificadores de ruta', async () => {
      await expect(controller.correct('t1', 'ch-1', 'm-9', { body: 'quise decir' } as never, CLIENTE)).resolves.toBe('corregido');

      expect(conversation.correct).toHaveBeenCalledWith({
        tenantId: 't1',
        actor: ACTOR_CLIENTE,
        channelId: 'ch-1',
        messageId: 'm-9',
        dto: { body: 'quise decir' },
      });
    });

    it('cerrar el canal va al servicio de canales y no al de conversación: el caso sigue su curso', async () => {
      await expect(controller.close('t1', 'ch-1', { reason: 'resuelto' } as never, CLIENTE)).resolves.toBe('canal-cerrado');

      expect(channels.closeChannel).toHaveBeenCalledWith({
        tenantId: 't1',
        actor: ACTOR_CLIENTE,
        channelId: 'ch-1',
        dto: { reason: 'resuelto' },
      });
      expect(conversation.markRead).not.toHaveBeenCalled();
    });

    it('marcar leído desenvuelve la secuencia del cuerpo, no manda el cuerpo entero', async () => {
      await expect(controller.read('t1', 'ch-1', { upToSequence: '17' } as never, CLIENTE)).resolves.toBe('leido');

      expect(conversation.markRead).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR_CLIENTE, channelId: 'ch-1', upToSequence: '17' });
    });

    it('avisar que escribo es efímero: no devuelve nada', async () => {
      await expect(controller.typing('t1', 'ch-1', CLIENTE)).resolves.toBeUndefined();

      expect(conversation.announceTyping).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR_CLIENTE, channelId: 'ch-1' });
    });

    it('lo sin leer es de todas mis conversaciones y no lleva canal', async () => {
      await expect(controller.unread('t1', CLIENTE)).resolves.toBe('sin-leer');

      expect(conversation.unread).toHaveBeenCalledWith({ tenantId: 't1', actor: ACTOR_CLIENTE });
    });
  });

  describe('hilo en vivo', () => {
    it('comprueba que quien escucha participa ANTES de suscribirle a nada', async () => {
      await controller.stream('t1', 'ch-1', CLIENTE);

      expect(messages.assertParticipates).toHaveBeenCalledWith('t1', 'ch-1', ACTOR_CLIENTE);
    });

    it('si no participa, no se abre el stream: nadie escucha la conversación de otro con un id', async () => {
      messages.assertParticipates.mockRejectedValueOnce(new Error('SUPPORT_CHANNEL_NOT_PARTICIPANT') as never);

      await expect(controller.stream('t1', 'ch-1', CLIENTE)).rejects.toThrow('SUPPORT_CHANNEL_NOT_PARTICIPANT');
      expect(realtime.sseFor).not.toHaveBeenCalled();
    });

    it('al cliente NO le llegan en vivo las notas internas del agente', async () => {
      realtime.sseFor.mockReturnValueOnce(of(evento('PUBLIC'), evento('INTERNAL'), evento('SYSTEM')));

      const flujo = await controller.stream('t1', 'ch-1', CLIENTE);
      const recibidos = await firstValueFrom(flujo.pipe(toArray()));

      expect(recibidos.map((e) => (e.data as { visibility: string }).visibility)).toEqual(['PUBLIC', 'SYSTEM']);
    });

    it('al agente sí, porque para eso las escribe', async () => {
      actors.resolve.mockResolvedValueOnce(ACTOR_AGENTE);
      realtime.sseFor.mockReturnValueOnce(of(evento('PUBLIC'), evento('INTERNAL')));

      const flujo = await controller.stream('t1', 'ch-1', { role: 'internal_operator', tenantId: 't1' } as AuthenticatedUser);
      const recibidos = await firstValueFrom(flujo.pipe(toArray()));

      expect(recibidos).toHaveLength(2);
    });

    it('cada evento conserva su nombre: el frontend escucha nombres concretos, no un genérico', async () => {
      realtime.sseFor.mockReturnValueOnce(of(evento('PUBLIC', 'message.read'), evento('PUBLIC', 'agent.typing')));

      const flujo = await controller.stream('t1', 'ch-1', CLIENTE);
      const recibidos = await firstValueFrom(flujo.pipe(toArray()));

      expect(recibidos.map((e) => e.type)).toEqual(['message.read', 'agent.typing']);
    });

    it('el hilo se pide para ese canal y ese tenant', async () => {
      await controller.stream('t1', 'ch-1', CLIENTE);

      expect(realtime.sseFor).toHaveBeenCalledWith('t1', 'ch-1');
    });
  });
});
