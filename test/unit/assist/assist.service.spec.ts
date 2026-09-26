import { afterEach, describe, expect, it, jest } from '@jest/globals';

/**
 * El asistente de la app, visto desde Core.
 *
 * Las propiedades que fijan estas pruebas son las que separan un botón de ayuda de un incidente:
 *
 * 1. **Apagado es 404 en toda la superficie.** Es lo que la app lee como «esconde el botón», y el
 *    kill switch tiene que funcionar sin redesplegar la app.
 * 2. **Al servicio de IA viaja una referencia opaca, nunca el token.** El asistente no debe poder
 *    hacerse pasar por nadie, y la referencia lleva el inquilino para que el mismo UUID en dos
 *    inquilinos jamás comparta hilo.
 * 3. **Cada desenlace del servicio llega al móvil en idioma de persona.** Un 401 de clave mal
 *    configurada es un problema NUESTRO y se ve como indisponibilidad; jamás como culpa del cliente.
 * 4. **El historial que no se puede leer no impide preguntar.** Se contesta el hilo vacío.
 */
type ServiceModule = typeof import('../../../src/modules/assist/assist.service.js');

const BASE_ENV = {
  ASSIST_ENABLED: true,
  ATLAS_AI_SERVICE_URL: 'http://ai.interno:3105',
  ATLAS_AI_SERVICE_KEY: ['clave-de-servicio', 'de-programa-de-pruebas', 'larga-de-verdad'].join('-'),
  ATLAS_AI_SERVICE_TIMEOUT_MS: 28_000,
};

async function cargar(overrides: Partial<typeof BASE_ENV> = {}): Promise<ServiceModule> {
  jest.resetModules();
  jest.doMock('../../../src/config/env.js', () => ({ env: { ...BASE_ENV, ...overrides } }));
  return import('../../../src/modules/assist/assist.service.js');
}

type ClienteFalso = {
  isConfigured: boolean;
  chat: jest.Mock;
  latestConversation: jest.Mock;
};

function clienteFalso(opciones: Partial<ClienteFalso> = {}): ClienteFalso {
  return {
    isConfigured: true,
    chat: jest.fn(async () => ({ status: 200, ok: true, json: {} })),
    latestConversation: jest.fn(async () => ({ status: 200, ok: true, json: { conversationId: null, turns: [] } })),
    ...opciones,
  };
}

const DTO = { prompt: '¿Cómo pago mi cuota?', clientMessageId: 'a1b2c3d4-0000-4000-8000-000000000001' };

describe('AssistService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('apagado contesta 404 en chat Y en conversación: la app esconde el botón entero', async () => {
    const { AssistService } = await cargar({ ASSIST_ENABLED: false });
    const cliente = clienteFalso();
    const service = new AssistService(cliente as never);

    await expect(service.chat('1', 'c-1', DTO)).rejects.toMatchObject({ status: 404 });
    await expect(service.conversation('1', 'c-1')).rejects.toMatchObject({ status: 404 });
    // Apagado significa apagado: al servicio de IA no le llega ni una llamada.
    expect(cliente.chat).not.toHaveBeenCalled();
    expect(cliente.latestConversation).not.toHaveBeenCalled();
  });

  it('encendido a medias (sin URL/clave) es indisponibilidad honesta, no un botón que desaparece', async () => {
    const { AssistService } = await cargar();
    const service = new AssistService(clienteFalso({ isConfigured: false }) as never);

    await expect(service.chat('1', 'c-1', DTO)).rejects.toMatchObject({ status: 503 });
  });

  it('al servicio de IA viaja tenant:customer como referencia opaca, nunca el token', async () => {
    const { AssistService } = await cargar();
    const cliente = clienteFalso({
      chat: jest.fn(async () => ({ status: 200, ok: true, json: { reply: 'Así se paga.', suggestHandoff: false } })),
    });
    const service = new AssistService(cliente as never);

    await service.chat('7', 'b0c1d2e3-0000-4000-8000-000000000002', DTO);

    expect(cliente.chat).toHaveBeenCalledWith('7:b0c1d2e3-0000-4000-8000-000000000002', {
      prompt: DTO.prompt,
      clientMessageId: DTO.clientMessageId,
    });
  });

  it('de la respuesta el móvil ve el texto y el hilo; usage, modelo y latencia se quedan en el servidor', async () => {
    const { AssistService } = await cargar();
    const service = new AssistService(
      clienteFalso({
        chat: jest.fn(async () => ({
          status: 200,
          ok: true,
          json: {
            reply: 'Entra a «Pagos» y toca la cuota.',
            suggestHandoff: false,
            conversationId: 'c1d2e3f4-0000-4000-8000-000000000003',
            turnId: 'd1e2f3a4-0000-4000-8000-000000000004',
            model: 'proveedor/modelo',
            usage: { totalTokens: 200 },
            providerLatencyMs: 900,
          },
        })),
      }) as never,
    );

    const vista = await service.chat('1', 'c-1', DTO);

    expect(vista).toEqual({
      reply: 'Entra a «Pagos» y toca la cuota.',
      suggestHandoff: false,
      conversationId: 'c1d2e3f4-0000-4000-8000-000000000003',
      turnId: 'd1e2f3a4-0000-4000-8000-000000000004',
    });
  });

  it('un 200 sin texto no es una respuesta: indisponibilidad antes que una burbuja vacía', async () => {
    const { AssistService } = await cargar();
    const service = new AssistService(
      clienteFalso({ chat: jest.fn(async () => ({ status: 200, ok: true, json: { reply: '   ' } })) }) as never,
    );

    await expect(service.chat('1', 'c-1', DTO)).rejects.toMatchObject({ status: 503 });
  });

  it('el 400 del servicio llega con SU texto, que ya está redactado para la persona', async () => {
    const { AssistService } = await cargar();
    const aviso = 'Por tu seguridad, no escribas correos, números de documento o teléfono, tu PIN ni códigos.';
    const service = new AssistService(
      clienteFalso({ chat: jest.fn(async () => ({ status: 400, ok: false, json: { message: aviso } })) }) as never,
    );

    await expect(service.chat('1', 'c-1', DTO)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ message: aviso }),
    });
  });

  it.each([
    [404, 404],
    [409, 409],
    [429, 429],
  ])('el %i del servicio se propaga como %i', async (deServicio, esperado) => {
    const { AssistService } = await cargar();
    const service = new AssistService(clienteFalso({ chat: jest.fn(async () => ({ status: deServicio, ok: false, json: {} })) }) as never);

    await expect(service.chat('1', 'c-1', DTO)).rejects.toMatchObject({ status: esperado });
  });

  it.each([[401], [403], [500], [502]])('el %i del servicio es indisponibilidad amable, nunca culpa del cliente', async (deServicio) => {
    const { AssistService } = await cargar();
    const service = new AssistService(clienteFalso({ chat: jest.fn(async () => ({ status: deServicio, ok: false, json: {} })) }) as never);

    await expect(service.chat('1', 'c-1', DTO)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ message: expect.stringContaining('hablar con una persona') }),
    });
  });

  it('un servicio que no contesta (red, timeout) también es indisponibilidad, no un 500 crudo', async () => {
    const { AssistService } = await cargar();
    const service = new AssistService(
      clienteFalso({
        chat: jest.fn(async () => {
          throw new Error('fetch failed');
        }),
      }) as never,
    );

    await expect(service.chat('1', 'c-1', DTO)).rejects.toMatchObject({ status: 503 });
  });

  it('la conversación llega en limpio y los turnos malformados se descartan sin romper el hilo', async () => {
    const { AssistService } = await cargar();
    const service = new AssistService(
      clienteFalso({
        latestConversation: jest.fn(async () => ({
          status: 200,
          ok: true,
          json: {
            conversationId: 'c1d2e3f4-0000-4000-8000-000000000003',
            turns: [
              { turnId: 't-1', prompt: '¿Cómo pago?', reply: 'Desde «Pagos».', suggestHandoff: false, createdAt: '2026-09-25T12:00:00Z' },
              { esto: 'no es un turno' },
              null,
            ],
          },
        })),
      }) as never,
    );

    const vista = await service.conversation('1', 'c-1');

    expect(vista.conversationId).toBe('c1d2e3f4-0000-4000-8000-000000000003');
    expect(vista.turns).toEqual([
      { turnId: 't-1', prompt: '¿Cómo pago?', reply: 'Desde «Pagos».', suggestHandoff: false, createdAt: '2026-09-25T12:00:00Z' },
    ]);
  });

  it('un historial que no se puede leer contesta el hilo vacío: no impide preguntar', async () => {
    const { AssistService } = await cargar();
    const porRed = new AssistService(
      clienteFalso({
        latestConversation: jest.fn(async () => {
          throw new Error('fetch failed');
        }),
      }) as never,
    );
    const porError = new AssistService(
      clienteFalso({ latestConversation: jest.fn(async () => ({ status: 503, ok: false, json: {} })) }) as never,
    );

    await expect(porRed.conversation('1', 'c-1')).resolves.toEqual({ conversationId: null, turns: [] });
    await expect(porError.conversation('1', 'c-1')).resolves.toEqual({ conversationId: null, turns: [] });
  });

  it('el 404 del servicio al leer la conversación SÍ se propaga: es el interruptor del otro lado', async () => {
    const { AssistService } = await cargar();
    const service = new AssistService(
      clienteFalso({ latestConversation: jest.fn(async () => ({ status: 404, ok: false, json: {} })) }) as never,
    );

    await expect(service.conversation('1', 'c-1')).rejects.toMatchObject({ status: 404 });
  });
});
