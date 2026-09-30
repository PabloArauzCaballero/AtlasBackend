import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ROLES_KEY } from '../../../src/common/decorators/roles.decorator.js';
import { AssistController } from '../../../src/modules/assist/assist.controller.js';
import { PortalAssistController } from '../../../src/modules/assist/portal-assist.controller.js';

/**
 * El historial de conversaciones del asistente (listar, leer por id, borrar), visto desde Core.
 *
 * Lo que se fija: (1) el contrato de respuesta es el mismo en móvil y portales; (2) lo ilegible
 * degrada a lista vacía, pero un id ajeno es 404 y una avería al leer o borrar UNA conversación es
 * 503 —nunca un «borrado» falso—; (3) cada portal habla con SU superficie y su referencia, así que
 * ve sólo su historial; (4) los guards y el tope son los de `conversation`.
 */
type ServiceModule = typeof import('../../../src/modules/assist/assist.service.js');
type ClientModule = typeof import('../../../src/modules/assist/ai-assist.client.js');

const BASE_ENV = {
  ASSIST_ENABLED: true,
  ATLAS_AI_SERVICE_URL: 'http://ai.interno:3105',
  ATLAS_AI_SERVICE_KEY: ['clave-de-servicio', 'de-programa-de-pruebas', 'larga-de-verdad'].join('-'),
  ATLAS_AI_SERVICE_TIMEOUT_MS: 28_000,
};
const ID = 'c1d2e3f4-0000-4000-8000-000000000003';

async function cargar(overrides: Partial<typeof BASE_ENV> = {}): Promise<ServiceModule & ClientModule> {
  jest.resetModules();
  jest.doMock('../../../src/config/env.js', () => ({ env: { ...BASE_ENV, ...overrides } }));
  return {
    ...(await import('../../../src/modules/assist/assist.service.js')),
    ...(await import('../../../src/modules/assist/ai-assist.client.js')),
  };
}

type Cliente = { isConfigured: boolean; listConversations: jest.Mock; getConversation: jest.Mock; deleteConversation: jest.Mock };
const ok = (json: Record<string, unknown>) => ({ status: 200, ok: true, json });
const fallo = (status: number, json: Record<string, unknown> = {}) => ({ status, ok: false, json });

function cliente(parcial: Partial<Cliente> = {}): Cliente {
  return {
    isConfigured: true,
    listConversations: jest.fn(async () => ok({ conversations: [] })),
    getConversation: jest.fn(async () => ok({ conversationId: ID, title: 'x', turns: [] })),
    deleteConversation: jest.fn(async () => ok({ deleted: 1 })),
    ...parcial,
  };
}

const PERSONAL = { surface: 'admin-portal', tenantId: '7', userId: '41', audience: 'personal' } as const;
const COMERCIO = { surface: 'merchant-portal', tenantId: '7', userId: '77', audience: 'comercio' } as const;
const TURNO = { turnId: 't-1', prompt: '¿Cómo pago?', reply: 'Desde «Pagos».', suggestHandoff: false, createdAt: '2026-09-25T12:00:00Z' };

describe('AssistService: historial de conversaciones', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lista con la referencia del móvil (sin superficie) y deja sólo filas bien formadas', async () => {
    const { AssistService } = await cargar();
    const c = cliente({
      listConversations: jest.fn(async () =>
        ok({
          conversations: [
            { conversationId: ID, title: '¿Cómo pago?', updatedAt: '2026-09-25T12:00:00.000Z', turnCount: 2, extra: 'no sale' },
            { conversationId: 'sin-titulo' },
            null,
            { conversationId: 'b', title: 'b', updatedAt: 3, turnCount: 'x' },
          ],
        }),
      ),
    });

    const vista = await new AssistService(c as never).conversations('1', 'c-1');

    expect(c.listConversations).toHaveBeenCalledWith('1:c-1', undefined);
    expect(vista).toEqual({
      conversations: [
        { conversationId: ID, title: '¿Cómo pago?', updatedAt: '2026-09-25T12:00:00.000Z', turnCount: 2 },
        { conversationId: 'b', title: 'b', updatedAt: '', turnCount: 0 },
      ],
    });
  });

  it('un cuerpo sin lista, un error del servicio o la red caída degradan a lista vacía', async () => {
    const { AssistService } = await cargar();
    const sinLista = new AssistService(cliente({ listConversations: jest.fn(async () => ok({})) }) as never);
    const en503 = new AssistService(cliente({ listConversations: jest.fn(async () => fallo(503)) }) as never);
    const porRed = new AssistService(
      cliente({
        listConversations: jest.fn(async () => {
          throw new Error('fetch failed');
        }),
      }) as never,
    );

    for (const s of [sinLista, en503, porRed]) await expect(s.conversations('1', 'c-1')).resolves.toEqual({ conversations: [] });
  });

  it('apagado responde 404 en las tres operaciones, en Core y en el servicio', async () => {
    const apagado = await cargar({ ASSIST_ENABLED: false });
    const c = cliente();
    const s = new apagado.AssistService(c as never);
    await expect(s.conversations('1', 'c-1')).rejects.toMatchObject({ status: 404 });
    await expect(s.conversationById('1', 'c-1', ID)).rejects.toMatchObject({ status: 404 });
    await expect(s.deleteConversation('1', 'c-1', ID)).rejects.toMatchObject({ status: 404 });
    expect(c.listConversations).not.toHaveBeenCalled();

    const { AssistService } = await cargar();
    const otroLado = new AssistService(
      cliente({
        listConversations: jest.fn(async () => fallo(404)),
        getConversation: jest.fn(async () => fallo(404, { message: 'Not Found' })),
      }) as never,
    );
    await expect(otroLado.conversations('1', 'c-1')).rejects.toMatchObject({ status: 404, response: { code: 'ASSIST_DISABLED' } });
    await expect(otroLado.conversationById('1', 'c-1', ID)).rejects.toMatchObject({ status: 404, response: { code: 'ASSIST_DISABLED' } });
  });

  it('lee una conversación por id con su título y descarta turnos mal formados', async () => {
    const { AssistService } = await cargar();
    const c = cliente({
      getConversation: jest.fn(async () => ok({ conversationId: ID, title: '¿Cómo pago?', turns: [TURNO, { roto: true }, null] })),
    });

    const vista = await new AssistService(c as never).conversationById('1', 'c-1', ID);

    expect(c.getConversation).toHaveBeenCalledWith('1:c-1', ID, undefined);
    expect(vista).toEqual({ conversationId: ID, title: '¿Cómo pago?', turns: [TURNO] });
  });

  it('un cuerpo sin id ni título toma el id pedido y título vacío', async () => {
    const { AssistService } = await cargar();
    const vista = await new AssistService(cliente({ getConversation: jest.fn(async () => ok({})) }) as never).conversationById(
      '1',
      'c-1',
      ID,
    );
    expect(vista).toEqual({ conversationId: ID, title: '', turns: [] });
  });

  it('un id ajeno o inexistente es 404 ASSIST_CONVERSATION_NOT_FOUND, distinto del interruptor apagado', async () => {
    const { AssistService } = await cargar();
    const s = new AssistService(
      cliente({ getConversation: jest.fn(async () => fallo(404, { message: 'Conversación no encontrada' })) }) as never,
    );

    await expect(s.conversationById('1', 'c-1', ID)).rejects.toMatchObject({
      status: 404,
      response: { code: 'ASSIST_CONVERSATION_NOT_FOUND' },
    });
  });

  it('una avería al leer o borrar UNA conversación es 503, no un vacío ni un «borrado» falso', async () => {
    const { AssistService } = await cargar();
    const s = new AssistService(
      cliente({
        getConversation: jest.fn(async () => fallo(502)),
        deleteConversation: jest.fn(async () => {
          throw new Error('fetch failed');
        }),
      }) as never,
    );

    await expect(s.conversationById('1', 'c-1', ID)).rejects.toMatchObject({ status: 503, response: { code: 'ASSIST_UNAVAILABLE' } });
    await expect(s.deleteConversation('1', 'c-1', ID)).rejects.toMatchObject({ status: 503, response: { code: 'ASSIST_UNAVAILABLE' } });
  });

  it('borra y devuelve sólo 0 o 1', async () => {
    const { AssistService } = await cargar();
    const uno = new AssistService(cliente() as never);
    const cero = new AssistService(cliente({ deleteConversation: jest.fn(async () => ok({ deleted: 0 })) }) as never);
    const raro = new AssistService(cliente({ deleteConversation: jest.fn(async () => ok({ deleted: 99 })) }) as never);

    await expect(uno.deleteConversation('1', 'c-1', ID)).resolves.toEqual({ deleted: 1 });
    await expect(cero.deleteConversation('1', 'c-1', ID)).resolves.toEqual({ deleted: 0 });
    await expect(raro.deleteConversation('1', 'c-1', ID)).resolves.toEqual({ deleted: 0 });
  });

  it('en un portal viaja la superficie y la referencia <surface>:<tenant>:<usuario>: cada portal ve sólo su historial', async () => {
    const { AssistService } = await cargar();
    const c = cliente();
    const s = new AssistService(c as never);

    await s.conversationsEnPortal(PERSONAL);
    await s.conversationByIdEnPortal(COMERCIO, ID);
    await s.deleteConversationEnPortal(PERSONAL, ID);

    expect(c.listConversations).toHaveBeenCalledWith('admin-portal:7:41', 'admin-portal');
    expect(c.getConversation).toHaveBeenCalledWith('merchant-portal:7:77', ID, 'merchant-portal');
    expect(c.deleteConversation).toHaveBeenCalledWith('admin-portal:7:41', ID, 'admin-portal');
  });

  it('el 503 de un portal habla a su audiencia', async () => {
    const { AssistService } = await cargar();
    const s = new AssistService(cliente({ getConversation: jest.fn(async () => fallo(500)) }) as never);

    await expect(s.conversationByIdEnPortal(PERSONAL, ID)).rejects.toMatchObject({
      response: { message: expect.stringContaining('Prueba de nuevo') },
    });
    await expect(s.conversationByIdEnPortal(COMERCIO, ID)).rejects.toMatchObject({
      response: { message: expect.stringContaining('Soporte y tutoriales') },
    });
  });
});

describe('AiAssistClient: historial', () => {
  const fetchOriginal = globalThis.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    globalThis.fetch = fetchOriginal;
  });

  it('listar y leer son GET, borrar es DELETE, sin cuerpo; la superficie sólo en cabecera y el id codificado', async () => {
    const fetchMock = jest.fn(async () => new Response('{"deleted":1}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { AiAssistClient } = await cargar();
    const client = new AiAssistClient();

    await client.listConversations('1:c-1');
    await client.getConversation('merchant-portal:7:77', ID, 'merchant-portal');
    await client.deleteConversation('admin-portal:7:41', ID, 'admin-portal');
    const resultado = await client.deleteConversation('1:c-1', 'a/b');

    const llamadas = fetchMock.mock.calls as unknown as Array<[string, { method: string; headers: Record<string, string>; body?: string }]>;
    expect(llamadas.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET http://ai.interno:3105/v1/assist/conversations',
      `GET http://ai.interno:3105/v1/assist/conversations/${ID}`,
      `DELETE http://ai.interno:3105/v1/assist/conversations/${ID}`,
      'DELETE http://ai.interno:3105/v1/assist/conversations/a%2Fb',
    ]);
    expect(llamadas.every(([, init]) => init.body === undefined && init.headers['content-type'] === undefined)).toBe(true);
    expect(llamadas[0][1].headers).not.toHaveProperty('x-atlas-assist-surface');
    expect(llamadas[1][1].headers['x-atlas-assist-surface']).toBe('merchant-portal');
    expect(llamadas[2][1].headers['x-atlas-actor-ref']).toBe('admin-portal:7:41');
    expect(resultado).toEqual({ status: 200, ok: true, json: { deleted: 1 } });
  });
});

describe('controladores del historial', () => {
  const usuario = { sub: 'u-1', role: 'customer', customerId: 'c-1' } as never;
  const personal = { sub: '41', role: 'internal_operator', internalUserId: '41' } as never;
  const comercio = { sub: '77', role: 'merchant', merchantUserId: '77' } as never;

  function servicio() {
    return {
      conversations: jest.fn(async (..._args: unknown[]) => ({ conversations: [] })),
      conversationById: jest.fn(async (..._args: unknown[]) => ({ conversationId: ID, title: '', turns: [] })),
      deleteConversation: jest.fn(async (..._args: unknown[]) => ({ deleted: 1 })),
      conversationsEnPortal: jest.fn(async (..._args: unknown[]) => ({ conversations: [] })),
      conversationByIdEnPortal: jest.fn(async (..._args: unknown[]) => ({ conversationId: ID, title: '', turns: [] })),
      deleteConversationEnPortal: jest.fn(async (..._args: unknown[]) => ({ deleted: 1 })),
    };
  }

  it('móvil: delega con el customerId del token; sin customerId es error nuestro', async () => {
    const s = servicio();
    const controller = new AssistController(s as never);

    await controller.conversations('1', usuario);
    await controller.conversationById('1', usuario, ID);
    await controller.deleteConversation('1', usuario, ID);

    expect(s.conversations).toHaveBeenCalledWith('1', 'c-1');
    expect(s.conversationById).toHaveBeenCalledWith('1', 'c-1', ID);
    expect(s.deleteConversation).toHaveBeenCalledWith('1', 'c-1', ID);
    expect(() => controller.conversations('1', { sub: 'u', role: 'customer' } as never)).toThrow('customerId');
    expect(s.conversations).toHaveBeenCalledTimes(1);
  });

  it('portal: la superficie la decide el rol; una ajena es 403 y no llega al servicio', async () => {
    const s = servicio();
    const controller = new PortalAssistController(s as never);

    await controller.conversations('1', personal, { surface: 'erp-staff' });
    await controller.conversationById('1', comercio, ID, { surface: 'merchant-portal' });
    await controller.deleteConversation('1', personal, ID, { surface: 'dashboards' });

    expect(s.conversationsEnPortal).toHaveBeenCalledWith({ surface: 'erp-staff', tenantId: '1', userId: '41', audience: 'personal' });
    expect(s.conversationByIdEnPortal).toHaveBeenCalledWith(
      { surface: 'merchant-portal', tenantId: '1', userId: '77', audience: 'comercio' },
      ID,
    );
    expect(s.deleteConversationEnPortal).toHaveBeenCalledWith(
      { surface: 'dashboards', tenantId: '1', userId: '41', audience: 'personal' },
      ID,
    );

    await expect(controller.conversations('1', personal, { surface: 'merchant-portal' })).rejects.toMatchObject({ status: 403 });
    await expect(controller.conversationById('1', comercio, ID, { surface: 'admin-portal' })).rejects.toMatchObject({ status: 403 });
    await expect(controller.deleteConversation('1', comercio, ID, { surface: 'risk-portal' })).rejects.toMatchObject({ status: 403 });
    await expect(controller.conversationById('1', usuario, ID, { surface: 'admin-portal' })).rejects.toMatchObject({ status: 403 });
    expect(s.conversationsEnPortal).toHaveBeenCalledTimes(1);
  });

  it('mismos roles que `conversation`: móvil sólo customer; portales personal y comercio, nunca customer ni system', () => {
    for (const nombre of ['conversations', 'conversationById', 'deleteConversation'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, AssistController.prototype[nombre])).toEqual(['customer']);
      expect(Reflect.getMetadata(ROLES_KEY, PortalAssistController.prototype[nombre])).toEqual(
        Reflect.getMetadata(ROLES_KEY, PortalAssistController.prototype.conversation),
      );
    }
  });
});
