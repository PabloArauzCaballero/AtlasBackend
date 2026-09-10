import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EngineAudioClient } from '../../../src/modules/mobile-welcome-audio/engine-audio.client.js';
import { env } from '../../../src/config/env.js';

/**
 * El worker de locución del motor.
 *
 * Tres decisiones, y las tres cuestan dinero o rompen el saludo en el teléfono.
 *
 * Un cuerpo diminuto NO es un audio: es un error servido con 200, que es como responden varias
 * pasarelas cuando la cuota se agota. Sin esa comprobación el móvil se descargaría doscientos bytes
 * de JSON con extensión `.mp3` y el fallo aparecería en el teléfono, como un saludo que no suena y
 * no dice por qué.
 *
 * El motor envuelve sus respuestas en `{ data }` en unas rutas y no en otras: se aceptan las DOS
 * formas en vez de asumir una, porque asumir la equivocada devuelve el sobre como si fuera el
 * contenido y entonces `requestId` es `undefined` sin que nada haya fallado.
 *
 * Y la credencial es la del plano de gestión, con preferencia por la propia del audio para poder
 * revocarla sola. NUNCA cae a la de ejecución de decisiones.
 */
type Clave = keyof typeof env;

const original = new Map<Clave, unknown>();

function poner(valores: Partial<Record<Clave, unknown>>): void {
  for (const [clave, valor] of Object.entries(valores) as Array<[Clave, unknown]>) {
    if (!original.has(clave)) original.set(clave, (env as Record<string, unknown>)[clave]);
    (env as Record<string, unknown>)[clave] = valor;
  }
}

function respuesta(cuerpo: unknown, estado = 200, cabeceras: Record<string, string> = {}) {
  const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    text: async () => texto,
    arrayBuffer: async () => (cuerpo instanceof Buffer ? cuerpo : Buffer.from(texto)),
    headers: { get: (clave: string) => cabeceras[clave.toLowerCase()] ?? null },
  };
}

describe('EngineAudioClient', () => {
  let fetchMock: jest.Mock;
  let client: EngineAudioClient;

  beforeEach(() => {
    poner({
      DECISION_ENGINE_BASE_URL: 'http://motor:4000/',
      DECISION_ENGINE_AUDIO_API_KEY: 'llave-audio',
      DECISION_ENGINE_GOVERNANCE_API_KEY: 'llave-gobierno',
      DECISION_ENGINE_API_KEY: 'llave-ejecucion',
      DECISION_ENGINE_AUDIO_TIMEOUT_MS: 1000,
    });
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    client = new EngineAudioClient();
  });

  afterEach(() => {
    for (const [clave, valor] of original) (env as Record<string, unknown>)[clave] = valor;
    original.clear();
    jest.restoreAllMocks();
  });

  describe('credencial y configuración', () => {
    it('sin URL o sin llave no está configurado, y eso se distingue de un motor caído', () => {
      expect(client.isConfigured).toBe(true);

      poner({ DECISION_ENGINE_AUDIO_API_KEY: undefined, DECISION_ENGINE_GOVERNANCE_API_KEY: undefined });
      expect(client.isConfigured).toBe(false);

      poner({ DECISION_ENGINE_AUDIO_API_KEY: 'k', DECISION_ENGINE_BASE_URL: undefined });
      expect(client.isConfigured).toBe(false);
    });

    it('prefiere la llave PROPIA del audio: existe aparte para poder revocarla sola', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1' }) as never);

      await client.enqueue('1', 'WELCOME', {});

      expect((fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers['x-api-key']).toBe('llave-audio');
    });

    it('sin la propia cae a la de GOBIERNO y nunca a la de ejecución de decisiones', async () => {
      poner({ DECISION_ENGINE_AUDIO_API_KEY: undefined });
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1' }) as never);

      await client.enqueue('1', 'WELCOME', {});

      const cabeceras = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
      expect(cabeceras['x-api-key']).toBe('llave-gobierno');
      expect(cabeceras['x-api-key']).not.toBe('llave-ejecucion');
    });

    it('el inquilino viaja en su cabecera y la barra final de la base no duplica la ruta', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1' }) as never);

      await client.enqueue('7', 'WELCOME', {});

      const [url, opciones] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(url).toBe('http://motor:4000/v1/workers/audio-tts/runs');
      expect(opciones.headers['x-tenant-id']).toBe('7');
    });
  });

  describe('encargar la locución', () => {
    it('manda plantilla y variables, y devuelve con qué consultarla', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'RUNNING' }) as never);

      const encargo = await client.enqueue('1', 'WELCOME', { nombre: 'Ana' });

      expect(encargo).toEqual({ requestId: 'r1', status: 'RUNNING' });
      expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body)).toEqual({
        templateCode: 'WELCOME',
        variables: { nombre: 'Ana' },
      });
    });

    it('acepta las DOS formas de respuesta del motor: envuelta en `data` y sin envolver', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ data: { requestId: 'r1', status: 'QUEUED' } }) as never);

      await expect(client.enqueue('1', 'WELCOME', {})).resolves.toEqual({ requestId: 'r1', status: 'QUEUED' });
    });

    it('sin estado se asume encolada, no terminada', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1' }) as never);

      await expect(client.enqueue('1', 'WELCOME', {})).resolves.toHaveProperty('status', 'QUEUED');
    });

    it('un 202 SIN identificador es un fallo: sin él no hay nada que consultar después', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ status: 'QUEUED' }, 202) as never);

      await expect(client.enqueue('1', 'WELCOME', {})).rejects.toThrow('sin devolver requestId');
    });

    it('un error del motor llega con su estado y un recorte del cuerpo, no como un fallo mudo', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ error: 'plantilla no existe' }, 422) as never);

      await expect(client.enqueue('1', 'MALA', {})).rejects.toThrow('422');
    });

    it('NO reintenta: cada generación cuesta dinero y una segunda síntesis se factura', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ error: 'x' }, 500) as never);

      await expect(client.enqueue('1', 'WELCOME', {})).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('un cuerpo que no es JSON no revienta el cliente: se trata como respuesta vacía', async () => {
      fetchMock.mockResolvedValueOnce(respuesta('<html>ok</html>') as never);

      await expect(client.enqueue('1', 'WELCOME', {})).rejects.toThrow('sin devolver requestId');
    });
  });

  describe('consultar el estado', () => {
    it('pide la ejecución por su identificador, escapado', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ status: 'SUCCEEDED' }) as never);

      await client.status('1', 'r 1/2');

      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://motor:4000/v1/workers/audio-tts/runs/r%201%2F2');
    });

    it('un cuerpo vacío se lee como encolada y con error nulo, no como éxito', async () => {
      fetchMock.mockResolvedValueOnce(respuesta('') as never);

      await expect(client.status('1', 'r1')).resolves.toEqual({ status: 'QUEUED', errorMessage: null });
    });

    it('un fallo del motor llega con su mensaje para poder enseñarlo', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ status: 'FAILED', errorMessage: 'voz no disponible' }) as never);

      await expect(client.status('1', 'r1')).resolves.toEqual({ status: 'FAILED', errorMessage: 'voz no disponible' });
    });
  });

  describe('los bytes del audio', () => {
    it('llegan con su tipo real y se re-sirven desde el servidor, sin URL firmada', async () => {
      const mp3 = Buffer.alloc(2048, 1);
      fetchMock.mockResolvedValueOnce(respuesta(mp3, 200, { 'content-type': 'audio/mpeg' }) as never);

      const audio = await client.audio('1', 'r1');

      expect(audio.bytes.length).toBe(2048);
      expect(audio.mimeType).toBe('audio/mpeg');
    });

    it('sin tipo declarado se asume mp3 en vez de dejarlo vacío', async () => {
      fetchMock.mockResolvedValueOnce(respuesta(Buffer.alloc(1024, 1)) as never);

      await expect(client.audio('1', 'r1')).resolves.toHaveProperty('mimeType', 'audio/mpeg');
    });

    it('un cuerpo diminuto NO es un audio: es un error servido con 200 cuando se agota la cuota', async () => {
      fetchMock.mockResolvedValueOnce(respuesta(Buffer.from('{"error":"quota exceeded"}'), 200, { 'content-type': 'audio/mpeg' }) as never);

      await expect(client.audio('1', 'r1')).rejects.toThrow('no es reproducible');
    });

    it('un no-2xx al servir el audio se declara con su estado', async () => {
      fetchMock.mockResolvedValueOnce(respuesta('', 404) as never);

      await expect(client.audio('1', 'r1')).rejects.toThrow('404');
    });
  });
});
