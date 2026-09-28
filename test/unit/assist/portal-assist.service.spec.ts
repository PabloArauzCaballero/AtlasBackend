import { afterEach, describe, expect, it, jest } from '@jest/globals';

/**
 * El asistente de los portales, visto desde Core.
 *
 * Comparte servicio con el móvil, así que lo que se fija aquí es lo que CAMBIA en un portal:
 *
 * 1. **La superficie viaja en cabecera y parte la referencia.** `<surface>:<tenant>:<usuario>`,
 *    para que cada portal tenga su hilo y un comercio nunca comparta uno con el personal.
 * 2. **La referencia respeta el alfabeto del servicio.** Un id raro viaja como hash corto.
 * 3. **El error amable habla a SU audiencia.** Al personal no se le manda a «Soporte» de la app.
 * 4. **`mode: 'sin-ia'` llega al portal**, y lo demás (404 apagado, 409/429) es igual que en el móvil.
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

type ClienteFalso = { isConfigured: boolean; chat: jest.Mock; latestConversation: jest.Mock };

function clienteFalso(opciones: Partial<ClienteFalso> = {}): ClienteFalso {
  return {
    isConfigured: true,
    chat: jest.fn(async () => ({ status: 200, ok: true, json: { reply: 'Desde «Solicitudes».' } })),
    latestConversation: jest.fn(async () => ({ status: 200, ok: true, json: { conversationId: null, turns: [] } })),
    ...opciones,
  };
}

const PERSONAL = { surface: 'admin-portal', tenantId: '7', userId: '41', audience: 'personal' } as const;
const COMERCIO = { surface: 'merchant-portal', tenantId: '7', userId: '77', audience: 'comercio' } as const;
const DTO = {
  surface: 'admin-portal' as const,
  prompt: '¿Dónde apruebo una solicitud?',
  clientMessageId: 'a1b2c3d4-0000-4000-8000-000000000001',
  screen: 'Solicitudes',
};

describe('AssistService en los portales', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('manda la superficie aparte y la referencia <surface>:<tenant>:<usuario>; la superficie no va en el cuerpo', async () => {
    const { AssistService } = await cargar();
    const cliente = clienteFalso();

    await new AssistService(cliente as never).chatEnPortal(PERSONAL, DTO);

    expect(cliente.chat).toHaveBeenCalledWith(
      'admin-portal:7:41',
      { prompt: DTO.prompt, clientMessageId: DTO.clientMessageId, screen: 'Solicitudes' },
      'admin-portal',
    );
  });

  it('la conversación también se lee por superficie: cada portal tiene su hilo', async () => {
    const { AssistService } = await cargar();
    const cliente = clienteFalso();
    const service = new AssistService(cliente as never);

    await service.conversationEnPortal(COMERCIO);
    await service.conversationEnPortal({ ...PERSONAL, surface: 'dashboards' });

    expect(cliente.latestConversation).toHaveBeenNthCalledWith(1, 'merchant-portal:7:77', 'merchant-portal');
    expect(cliente.latestConversation).toHaveBeenNthCalledWith(2, 'dashboards:7:41', 'dashboards');
  });

  it('un id fuera del alfabeto del servicio viaja como hash hex corto y estable, nunca tal cual', async () => {
    const { AssistService } = await cargar();
    const cliente = clienteFalso();
    const service = new AssistService(cliente as never);

    await service.conversationEnPortal({ ...PERSONAL, userId: 'persona@correo.com' });
    await service.conversationEnPortal({ ...PERSONAL, userId: 'persona@correo.com' });

    const [primera, segunda] = cliente.latestConversation.mock.calls.map((llamada) => llamada[0] as string);
    expect(primera).toMatch(/^admin-portal:7:[0-9a-f]{16}$/);
    expect(primera).not.toContain('correo');
    expect(segunda).toBe(primera);
    expect(primera.length).toBeLessThanOrEqual(128);
  });

  it('reenvía `mode: "sin-ia"` al portal, y no inventa el campo cuando el servicio no lo manda', async () => {
    const { AssistService } = await cargar();
    const sinIa = new AssistService(
      clienteFalso({
        chat: jest.fn(async () => ({ status: 200, ok: true, json: { reply: 'Del catálogo.', mode: 'sin-ia', usage: {} } })),
      }) as never,
    );
    const conIa = new AssistService(clienteFalso() as never);

    await expect(sinIa.chatEnPortal(PERSONAL, DTO)).resolves.toEqual({
      reply: 'Del catálogo.',
      suggestHandoff: false,
      conversationId: null,
      turnId: null,
      mode: 'sin-ia',
    });
    await expect(conIa.chatEnPortal(PERSONAL, DTO)).resolves.not.toHaveProperty('mode');
  });

  it('apagado contesta 404 también en los portales, sin llamar al servicio de IA', async () => {
    const { AssistService } = await cargar({ ASSIST_ENABLED: false });
    const cliente = clienteFalso();
    const service = new AssistService(cliente as never);

    await expect(service.chatEnPortal(PERSONAL, DTO)).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({ code: 'ASSIST_DISABLED' }),
    });
    await expect(service.conversationEnPortal(COMERCIO)).rejects.toMatchObject({ status: 404 });
    expect(cliente.chat).not.toHaveBeenCalled();
    expect(cliente.latestConversation).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'ASSIST_IN_FLIGHT'],
    [429, 'ASSIST_BUSY'],
  ])('el %i del servicio se traduce igual que en el móvil (%s)', async (status, code) => {
    const { AssistService } = await cargar();
    const service = new AssistService(clienteFalso({ chat: jest.fn(async () => ({ status, ok: false, json: {} })) }) as never);

    await expect(service.chatEnPortal(COMERCIO, { ...DTO, surface: 'merchant-portal' })).rejects.toMatchObject({
      status,
      response: expect.objectContaining({ code }),
    });
  });

  it('al personal interno la indisponibilidad le dice que pruebe más tarde, no que vaya a Soporte de la app', async () => {
    const { AssistService } = await cargar();
    const service = new AssistService(clienteFalso({ chat: jest.fn(async () => ({ status: 502, ok: false, json: {} })) }) as never);

    const error = await service.chatEnPortal(PERSONAL, DTO).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 503, response: expect.objectContaining({ code: 'ASSIST_UNAVAILABLE' }) });
    const mensaje = (error as { response: { message: string } }).response.message;
    expect(mensaje).toContain('Prueba de nuevo en unos minutos');
    expect(mensaje).not.toContain('hablar con una persona');
  });

  it('al comercio la indisponibilidad lo manda al «Soporte y tutoriales» de su portal, también si la red falla', async () => {
    const { AssistService } = await cargar();
    const service = new AssistService(
      clienteFalso({
        chat: jest.fn(async () => {
          throw new Error('fetch failed');
        }),
      }) as never,
    );

    await expect(service.chatEnPortal(COMERCIO, { ...DTO, surface: 'merchant-portal' })).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ message: expect.stringContaining('«Soporte y tutoriales» del portal') }),
    });
  });

  it('el móvil no cambia: sin superficie, sin cabecera y con su mensaje de siempre', async () => {
    const { AssistService } = await cargar();
    const cliente = clienteFalso({ chat: jest.fn(async () => ({ status: 503, ok: false, json: {} })) });

    await expect(
      new AssistService(cliente as never).chat('7', 'c-1', { prompt: 'hola', clientMessageId: DTO.clientMessageId }),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ message: expect.stringContaining('hablar con una persona desde Soporte') }),
    });
    expect(cliente.chat.mock.calls[0]).toHaveLength(2);
  });
});
