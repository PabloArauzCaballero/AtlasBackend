import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { AssistController } from '../../../src/modules/assist/assist.controller.js';
import { assistChatSchema } from '../../../src/modules/assist/assist.schemas.js';

/**
 * El borde HTTP del asistente.
 *
 * Tres cosas y ninguna más: la identidad sale del TOKEN (un token de cliente sin `customerId` es un
 * error nuestro, no un hilo anónimo compartido), el 409/429 viaja con `Retry-After` para que el
 * móvil espere lo que se le dice, y el contrato Zod corta en el borde lo que el servicio de IA
 * cobraría por rechazar.
 */
describe('AssistController', () => {
  const usuario = { sub: 'u-1', role: 'customer', customerId: 'c-1' } as never;

  function montar(service: Partial<{ chat: jest.Mock; conversation: jest.Mock }> = {}) {
    const chat = service.chat ?? jest.fn(async () => ({ reply: 'ok', suggestHandoff: false, conversationId: null, turnId: null }));
    const conversation = service.conversation ?? jest.fn(async () => ({ conversationId: null, turns: [] }));
    const response = { setHeader: jest.fn() };
    const controller = new AssistController({ chat, conversation } as never);
    return { controller, chat, conversation, response };
  }

  const DTO = { prompt: '¿Cómo pago?', clientMessageId: 'a1b2c3d4-0000-4000-8000-000000000001' };

  it('delega con el customerId del token y devuelve la vista tal cual', async () => {
    const { controller, chat, response } = montar();

    const vista = await controller.chat('1', usuario, DTO, response);

    expect(chat).toHaveBeenCalledWith('1', 'c-1', DTO);
    expect(vista).toEqual({ reply: 'ok', suggestHandoff: false, conversationId: null, turnId: null });
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('un token de cliente sin customerId es un error nuestro, nunca un hilo anónimo', async () => {
    const { controller, chat, response } = montar();

    await expect(controller.chat('1', { sub: 'u-1', role: 'customer' } as never, DTO, response)).rejects.toThrow('customerId');
    expect(chat).not.toHaveBeenCalled();
  });

  it('el 409 y el 429 salen con Retry-After: el móvil espera lo que se le dice', async () => {
    const en409 = montar({ chat: jest.fn(async () => Promise.reject(new ConflictException('sigue en curso'))) });
    await expect(en409.controller.chat('1', usuario, DTO, en409.response)).rejects.toMatchObject({ status: 409 });
    expect(en409.response.setHeader).toHaveBeenCalledWith('Retry-After', '2');

    const en429 = montar({ chat: jest.fn(async () => Promise.reject(new HttpException('ocupado', 429))) });
    await expect(en429.controller.chat('1', usuario, DTO, en429.response)).rejects.toMatchObject({ status: 429 });
    expect(en429.response.setHeader).toHaveBeenCalledWith('Retry-After', '2');
  });

  it('los demás errores pasan sin cabecera: un 404 no es «vuelve en un momento»', async () => {
    const { controller, response } = montar({ chat: jest.fn(async () => Promise.reject(new NotFoundException())) });

    await expect(controller.chat('1', usuario, DTO, response)).rejects.toMatchObject({ status: 404 });
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('la conversación delega con la identidad del token', async () => {
    const { controller, conversation } = montar();

    await controller.conversation('1', usuario);

    expect(conversation).toHaveBeenCalledWith('1', 'c-1');
  });

  describe('assistChatSchema', () => {
    it('acepta la forma completa y recorta espacios del prompt', () => {
      const parsed = assistChatSchema.parse({
        prompt: '  ¿Cómo pago?  ',
        clientMessageId: 'a1b2c3d4-0000-4000-8000-000000000001',
        conversationId: 'b1c2d3e4-0000-4000-8000-000000000002',
        screen: 'pagos',
      });
      expect(parsed.prompt).toBe('¿Cómo pago?');
      expect(parsed.screen).toBe('pagos');
    });

    it('corta en el borde lo que el servicio de IA cobraría por rechazar', () => {
      expect(assistChatSchema.safeParse({ prompt: '   ', clientMessageId: DTO.clientMessageId }).success).toBe(false);
      expect(assistChatSchema.safeParse({ prompt: 'x'.repeat(2001), clientMessageId: DTO.clientMessageId }).success).toBe(false);
      expect(assistChatSchema.safeParse({ prompt: 'hola', clientMessageId: 'no-es-uuid' }).success).toBe(false);
      expect(assistChatSchema.safeParse({ prompt: 'hola', clientMessageId: DTO.clientMessageId, screen: 'otra-cosa' }).success).toBe(false);
    });
  });
});
