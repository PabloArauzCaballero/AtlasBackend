import { afterEach, describe, expect, it, jest } from '@jest/globals';

/**
 * El transporte hacia AtlasAIService.
 *
 * Lo que se fija aquí es el CONTRATO del cable: qué cabeceras viajan (la clave de servicio y la
 * referencia opaca, nada más), cómo se compone la URL, y que un cuerpo raro del otro lado —HTML de
 * un proxy, un cuerpo vacío— degrada a `{}` conservando el código de estado, que es el dato con el
 * que el servicio de aplicación decide. Sin reintentos a propósito: cada llamada al proveedor se
 * factura, y el reintento legítimo es el del móvil, idempotente por `clientMessageId`.
 */
type ClientModule = typeof import('../../../src/modules/assist/ai-assist.client.js');

const SERVICE_KEY = ['clave-de-servicio', 'de-programa-de-pruebas', 'larga-de-verdad'].join('-');

const BASE_ENV = {
  ASSIST_ENABLED: true,
  ATLAS_AI_SERVICE_URL: 'http://ai.interno:3105/',
  ATLAS_AI_SERVICE_KEY: SERVICE_KEY,
  ATLAS_AI_SERVICE_TIMEOUT_MS: 28_000,
};

async function cargar(overrides: Partial<typeof BASE_ENV> = {}): Promise<ClientModule> {
  jest.resetModules();
  jest.doMock('../../../src/config/env.js', () => ({ env: { ...BASE_ENV, ...overrides } }));
  return import('../../../src/modules/assist/ai-assist.client.js');
}

function mockFetch(impl: (...args: unknown[]) => Promise<unknown>): jest.Mock {
  const mock = jest.fn(impl as never);
  (globalThis as { fetch: unknown }).fetch = mock as never;
  return mock;
}

function respuesta(status: number, body: string): { status: number; ok: boolean; text: () => Promise<string> } {
  return { status, ok: status >= 200 && status < 300, text: async () => body };
}

describe('AiAssistClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('manda la clave de servicio y la referencia opaca, y compone la URL sin barra doble', async () => {
    const fetchMock = mockFetch(async () => respuesta(200, '{"reply":"ok"}'));
    const { AiAssistClient } = await cargar();

    await new AiAssistClient().chat('1:c-1', { prompt: 'hola', clientMessageId: 'a1b2c3d4-0000-4000-8000-000000000001' });

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe('http://ai.interno:3105/v1/assist/chat');
    expect(init.method).toBe('POST');
    expect(init.headers['x-atlas-service-key']).toBe(SERVICE_KEY);
    expect(init.headers['x-atlas-actor-ref']).toBe('1:c-1');
    expect(JSON.parse(init.body)).toEqual({ prompt: 'hola', clientMessageId: 'a1b2c3d4-0000-4000-8000-000000000001' });
  });

  it('la conversación vigente viaja como GET, sin cuerpo y sin content-type', async () => {
    const fetchMock = mockFetch(async () => respuesta(200, '{"conversationId":null,"turns":[]}'));
    const { AiAssistClient } = await cargar();

    await new AiAssistClient().latestConversation('1:c-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body?: string }];
    expect(url).toBe('http://ai.interno:3105/v1/assist/conversations/latest');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers['content-type']).toBeUndefined();
  });

  it('un cuerpo no-JSON (el HTML de un proxy) degrada a {} y conserva el código, que es el dato útil', async () => {
    mockFetch(async () => respuesta(502, '<html>Bad Gateway</html>'));
    const { AiAssistClient } = await cargar();

    const resultado = await new AiAssistClient().latestConversation('1:c-1');

    expect(resultado).toEqual({ status: 502, ok: false, json: {} });
  });

  it('un cuerpo vacío también degrada a {} sin reventar', async () => {
    mockFetch(async () => respuesta(204, ''));
    const { AiAssistClient } = await cargar();

    const resultado = await new AiAssistClient().latestConversation('1:c-1');

    expect(resultado.json).toEqual({});
  });

  it('sin URL o sin clave se declara no configurado: quien llama debe distinguirlo de un servicio caído', async () => {
    const sinUrl = await cargar({ ATLAS_AI_SERVICE_URL: undefined });
    expect(new sinUrl.AiAssistClient().isConfigured).toBe(false);

    const sinClave = await cargar({ ATLAS_AI_SERVICE_KEY: undefined });
    expect(new sinClave.AiAssistClient().isConfigured).toBe(false);

    const completo = await cargar();
    expect(new completo.AiAssistClient().isConfigured).toBe(true);
  });
});
