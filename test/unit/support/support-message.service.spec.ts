import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { SupportMessageService } from '../../../src/modules/support/application/support-message.service.js';
import type { SupportMessageRepository } from '../../../src/modules/support/support-message.repository.js';
import type { SupportChannelRepository } from '../../../src/modules/support/support-channel.repository.js';
import type { SupportCaseTransitionService } from '../../../src/modules/support/application/support-case-transition.service.js';
import type { SupportRealtimeService } from '../../../src/modules/support/application/support-realtime.service.js';
import type { SupportAttachmentService } from '../../../src/modules/support/application/support-attachment.service.js';
import type { SupportAuditService } from '../../../src/modules/support/application/support-audit.service.js';
import type { SupportActor } from '../../../src/modules/support/application/support-actor.service.js';

/**
 * Escribir en la conversación. Es el único camino: no hay edición ni borrado.
 *
 * Lo que se fija son cuatro decisiones que no dan error cuando se rompen.
 *
 * Cuando alguien pega un secreto, la vista guarda el texto REDACTADO y el original se CIFRA. No se
 * descarta —a veces hay que probar qué se envió; un reclamo por un OTP compartido depende de ello—
 * y no se deja en claro, porque un secreto legible en una transcripción que dura años es una fuga
 * esperando a ocurrir.
 *
 * El aviso del hilo en vivo va DENTRO del `if (created)`: un reintento por mala red no debe hacer
 * sonar el chat otra vez. Y viaja con el cuerpo ya redactado, nunca con el original — el bus
 * efímero no es lugar para un secreto que la base guarda bajo llave.
 *
 * El adjunto se comprueba ANTES de escribir: un mensaje inmutable no debe quedar prometiendo un
 * comprobante que resultó inválido.
 *
 * Y la primera respuesta se marca cuando escribe un AGENTE, no cuando toma el caso: el indicador
 * mide cuánto tarda una persona en contestarle a otra, y tomar el caso deja al cliente esperando
 * exactamente igual. Faltaba por completo hasta que se probó de punta a punta, y por eso todo caso
 * atendido a tiempo figuraba incumplido.
 */
const CLIENTE = { actorType: 'CUSTOMER', actorId: '42', agentProfileId: null } as SupportActor;
const AGENTE = { actorType: 'AGENT', actorId: '7', agentProfileId: 'ag-1' } as SupportActor;

const COMANDO = {
  tenantId: 't1',
  channelId: 'ch-1',
  actor: CLIENTE,
  clientMessageId: 'uuid-1',
  body: 'Hola, no me llega el código',
  messageType: 'TEXT',
  visibility: 'PUBLIC' as const,
};

function mensaje(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    serverSequence: '5',
    senderActorType: 'CUSTOMER',
    messageType: 'TEXT',
    visibility: 'PUBLIC',
    bodyText: 'Hola, no me llega el código',
    redactedAt: null,
    createdAtValue: new Date('2026-09-10T10:00:00Z'),
    ...overrides,
  };
}

describe('SupportMessageService', () => {
  let messages: { append: jest.Mock; createRelation: jest.Mock; verifyChannelChain: jest.Mock };
  let channels: { requireById: jest.Mock; findById: jest.Mock; update: jest.Mock; findLiveParticipant: jest.Mock };
  let transitions: { recordFirstResponse: jest.Mock };
  let realtime: { emit: jest.Mock };
  let attachments: { verify: jest.Mock; persist: jest.Mock };
  let audit: { publish: jest.Mock };
  let service: SupportMessageService;

  beforeEach(() => {
    messages = {
      append: jest.fn(async () => ({ message: mensaje(), created: true })),
      createRelation: jest.fn(async () => ({ id: 1 })),
      verifyChannelChain: jest.fn(async () => ({ valid: true })),
    };
    channels = {
      requireById: jest.fn(async () => ({ id: 'ch-1', status: 'OPEN', caseId: 'caso-1', firstResponseAt: null })),
      findById: jest.fn(async () => ({ id: 'ch-1', status: 'OPEN', caseId: 'caso-1', firstResponseAt: null })),
      update: jest.fn(async () => undefined),
      findLiveParticipant: jest.fn(async () => ({ id: 'p-1' })),
    };
    transitions = { recordFirstResponse: jest.fn(async () => undefined) };
    realtime = { emit: jest.fn(() => undefined) };
    attachments = { verify: jest.fn(async () => ({ sha256: 'h1' })), persist: jest.fn(async () => ({ id: 3, sizeBytes: '10' })) };
    audit = { publish: jest.fn(async () => undefined) };

    const sequelize = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } as unknown as Sequelize;
    service = new SupportMessageService(
      sequelize,
      messages as unknown as SupportMessageRepository,
      channels as unknown as SupportChannelRepository,
      transitions as unknown as SupportCaseTransitionService,
      realtime as unknown as SupportRealtimeService,
      attachments as unknown as SupportAttachmentService,
      audit as unknown as SupportAuditService,
    );
  });

  describe('escribir', () => {
    it('un canal cerrado no admite mensajes', async () => {
      for (const estado of ['CLOSED', 'ABANDONED']) {
        channels.requireById.mockResolvedValueOnce({ id: 'ch-1', status: estado } as never);

        await expect(service.append(COMANDO)).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(messages.append).not.toHaveBeenCalled();
    });

    it('un texto sin secretos se guarda tal cual, sin cifrado ni versión de llave', async () => {
      await service.append(COMANDO);

      const escrito = messages.append.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(escrito.bodyText).toBe('Hola, no me llega el código');
      expect(escrito.bodyCiphertext).toBeNull();
      expect(escrito.keyVersion).toBeNull();
      expect(escrito.classification).toBe('NORMAL');
    });

    it('un secreto se REDACTA en la vista, se CIFRA aparte y el mensaje queda clasificado', async () => {
      await service.append({ ...COMANDO, body: 'mi contraseña es Atlas2026! y mi tarjeta 4111111111111111' });

      const escrito = messages.append.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(escrito.bodyText).not.toContain('4111111111111111');
      expect(escrito.bodyCiphertext).toEqual(expect.any(String));
      expect(escrito.keyVersion).toEqual(expect.any(String));
      expect(escrito.classification).toBe('RESTRICTED');
      expect(escrito.redactionReason).toBeTruthy();
    });

    it('el hash se calcula sobre el ORIGINAL: la cadena prueba lo que realmente se escribió', async () => {
      const original = 'mi tarjeta es 4111111111111111';
      await service.append({ ...COMANDO, body: original });

      const escrito = messages.append.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(escrito.originalBody).toBe(original);
    });

    it('tras hablar el cliente, el canal espera al AGENTE; tras hablar el agente, al usuario', async () => {
      await service.append(COMANDO);
      expect(channels.update).toHaveBeenLastCalledWith(
        't1',
        'ch-1',
        expect.objectContaining({ status: 'WAITING_AGENT' }),
        expect.anything(),
      );

      await service.append({ ...COMANDO, actor: AGENTE });
      expect(channels.update).toHaveBeenLastCalledWith(
        't1',
        'ch-1',
        expect.objectContaining({ status: 'WAITING_USER' }),
        expect.anything(),
      );
    });

    it('un canal que se está cerrando no cambia de estado por un mensaje', async () => {
      channels.requireById.mockResolvedValueOnce({ id: 'ch-1', status: 'CLOSING' } as never);

      await service.append(COMANDO);

      expect(channels.update).toHaveBeenLastCalledWith('t1', 'ch-1', expect.objectContaining({ status: 'CLOSING' }), expect.anything());
    });

    it('un reintento por mala red no vuelve a hacer sonar el chat ni toca el canal', async () => {
      messages.append.mockResolvedValueOnce({ message: mensaje(), created: false } as never);

      await service.append(COMANDO);

      expect(realtime.emit).not.toHaveBeenCalled();
      expect(channels.update).not.toHaveBeenCalled();
    });

    it('el aviso en vivo lleva el cuerpo REDACTADO y nunca el original cifrado', async () => {
      messages.append.mockResolvedValueOnce({
        message: mensaje({ bodyText: 'mi tarjeta es [redactado]', redactedAt: new Date() }),
        created: true,
      } as never);

      await service.append({ ...COMANDO, body: 'mi tarjeta es 4111111111111111' });

      const emitido = realtime.emit.mock.calls.at(-1)?.[0] as { payload: Record<string, unknown> };
      expect(emitido.payload.body).toBe('mi tarjeta es [redactado]');
      expect(JSON.stringify(emitido)).not.toContain('4111111111111111');
      expect(emitido.payload.redacted).toBe(true);
    });

    it('reutiliza la transacción de quien llama en vez de abrir otra anidada', async () => {
      const tx = {} as never;

      await service.append(COMANDO, tx);

      expect(channels.requireById).toHaveBeenCalledWith('t1', 'ch-1', { transaction: tx });
    });
  });

  describe('enviar (camino público)', () => {
    it('quien no participa en el canal no escribe', async () => {
      channels.findLiveParticipant.mockResolvedValueOnce(null as never);

      await expect(
        service.send({
          tenantId: 't1',
          actor: CLIENTE,
          channelId: 'ch-1',
          dto: { clientMessageId: 'u1', body: 'hola', messageType: 'TEXT' } as never,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(messages.append).not.toHaveBeenCalled();
    });

    it('el adjunto se verifica ANTES de escribir: un mensaje inmutable no promete un comprobante inválido', async () => {
      attachments.verify.mockRejectedValueOnce(new Error('SHA256_MISMATCH') as never);

      await expect(
        service.send({
          tenantId: 't1',
          actor: CLIENTE,
          channelId: 'ch-1',
          dto: { clientMessageId: 'u1', body: 'ahí va', messageType: 'TEXT', attachment: { storageKey: 'k/a.jpg' } } as never,
        }),
      ).rejects.toThrow('SHA256_MISMATCH');
      expect(messages.append).not.toHaveBeenCalled();
    });

    it('el adjunto guardado viaja en la respuesta: sin él, quien envió la foto no sabe con qué id pedirla', async () => {
      const dto = await service.send({
        tenantId: 't1',
        actor: CLIENTE,
        channelId: 'ch-1',
        dto: { clientMessageId: 'u1', body: 'ahí va', messageType: 'TEXT', attachment: { storageKey: 'k/a.jpg' } } as never,
      });

      expect(attachments.persist).toHaveBeenCalledWith(expect.objectContaining({ messageId: '9', caseId: 'caso-1' }));
      expect(dto.attachments).toHaveLength(1);
    });

    it('una respuesta a otro mensaje se enlaza y queda anotada en los metadatos', async () => {
      await service.send({
        tenantId: 't1',
        actor: CLIENTE,
        channelId: 'ch-1',
        dto: { clientMessageId: 'u1', body: 'sí', messageType: 'TEXT', replyToMessageId: 'm-3' } as never,
      });

      expect(messages.append).toHaveBeenCalledWith(expect.objectContaining({ metadata: { replyToMessageId: 'm-3' } }), expect.anything());
      expect(messages.createRelation).toHaveBeenCalledWith(
        expect.objectContaining({ relatedMessageId: 'm-3', relationType: 'REPLIES_TO' }),
      );
    });

    it('si el enlace falla, el mensaje ya escrito NO se pierde', async () => {
      messages.createRelation.mockRejectedValueOnce(new Error('mensaje borrado') as never);

      await expect(
        service.send({
          tenantId: 't1',
          actor: CLIENTE,
          channelId: 'ch-1',
          dto: { clientMessageId: 'u1', body: 'sí', messageType: 'TEXT', replyToMessageId: 'm-3' } as never,
        }),
      ).resolves.toBeDefined();
    });

    it('el mensaje del cliente NO dispara aviso al móvil: sería avisarle de algo que acaba de hacer', async () => {
      await service.send({
        tenantId: 't1',
        actor: CLIENTE,
        channelId: 'ch-1',
        dto: { clientMessageId: 'u1', body: 'hola', messageType: 'TEXT' } as never,
      });

      expect(audit.publish).not.toHaveBeenCalled();
    });

    it('el del equipo sí, con clave de idempotencia por mensaje', async () => {
      await service.send({
        tenantId: 't1',
        actor: AGENTE,
        channelId: 'ch-1',
        dto: { clientMessageId: 'u1', body: 'ya voy', messageType: 'TEXT' } as never,
      });

      expect(audit.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventCode: 'support.message.created', idempotencyKey: 'support-message-9' }),
      );
    });
  });

  describe('primera respuesta', () => {
    it('la marca un AGENTE que escribe, no el reparto del caso', async () => {
      await service.send({
        tenantId: 't1',
        actor: AGENTE,
        channelId: 'ch-1',
        dto: { clientMessageId: 'u1', body: 'ya voy', messageType: 'TEXT' } as never,
      });

      expect(transitions.recordFirstResponse).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'caso-1', actor: AGENTE }));
    });

    it('un mensaje del cliente no la marca nunca', async () => {
      await service.send({
        tenantId: 't1',
        actor: CLIENTE,
        channelId: 'ch-1',
        dto: { clientMessageId: 'u1', body: 'hola', messageType: 'TEXT' } as never,
      });

      expect(transitions.recordFirstResponse).not.toHaveBeenCalled();
    });

    it('un canal sin caso detrás no tiene primera respuesta que medir', async () => {
      channels.findById.mockResolvedValue({ id: 'ch-1', status: 'OPEN', caseId: null } as never);

      await service.send({
        tenantId: 't1',
        actor: AGENTE,
        channelId: 'ch-1',
        dto: { clientMessageId: 'u1', body: 'ya voy', messageType: 'TEXT' } as never,
      });

      expect(transitions.recordFirstResponse).not.toHaveBeenCalled();
    });

    it('no se reescribe si el canal ya tenía una: es la PRIMERA, no la última', async () => {
      const primera = new Date('2026-09-01T10:00:00Z');
      channels.findById.mockResolvedValue({ id: 'ch-1', status: 'OPEN', caseId: 'caso-1', firstResponseAt: primera } as never);

      await service.send({
        tenantId: 't1',
        actor: AGENTE,
        channelId: 'ch-1',
        dto: { clientMessageId: 'u1', body: 'y esto', messageType: 'TEXT' } as never,
      });

      expect(channels.update).toHaveBeenCalledWith('t1', 'ch-1', { firstResponseAt: primera });
    });
  });

  describe('participación e integridad', () => {
    it('la comprobación mira la participación VIVA y no el rol', async () => {
      await service.assertParticipates('t1', 'ch-1', AGENTE);

      expect(channels.findLiveParticipant).toHaveBeenCalledWith('ch-1', 'AGENT', '7');
    });

    it('el rechazo lleva un código que explica la causa', async () => {
      channels.findLiveParticipant.mockResolvedValueOnce(null as never);

      const fallo = await service.assertParticipates('t1', 'ch-1', AGENTE).catch((error: unknown) => error);

      expect((fallo as ForbiddenException).getResponse()).toMatchObject({ code: 'SUPPORT_CHANNEL_NOT_PARTICIPANT' });
    });

    it('la verificación de integridad delega en la cadena del canal', async () => {
      await expect(service.verifyIntegrity('ch-1')).resolves.toEqual({ valid: true });

      expect(messages.verifyChannelChain).toHaveBeenCalledWith('ch-1');
    });
  });
});
