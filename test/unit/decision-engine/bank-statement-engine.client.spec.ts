import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BankStatementEngineClient } from '../../../src/modules/decision-engine/bank-statement-engine.client.js';
import { env } from '../../../src/config/env.js';

/**
 * El worker de extractos del motor, visto desde el core.
 *
 * La distinción que sostiene todo el flujo, y lo único que se prueba aquí de verdad: **un motor
 * caído no es un extracto inválido**. Convertir un fallo de transporte en un rechazo le diría al
 * cliente que su documento no sirve por una avería que es nuestra, y su extracto —que sí valía—
 * quedaría descartado sin que nadie volviera a mirarlo. Por eso cualquier fallo de red, cualquier
 * 5xx y también agotar la espera devuelven `engineUnavailable`, que se reintenta; y sólo un
 * veredicto del motor (`PDF_INVALID`) es un rechazo.
 *
 * Agotar la espera merece su propio caso: la ejecución sigue VIVA en el motor y el siguiente
 * barrido la encontrará ya hecha —el motor deduplica por huella del archivo—, así que cerrarla aquí
 * como fallo tiraría un trabajo que probablemente ya terminó.
 *
 * Y la cascada de la llave: cae a la de gobierno y NUNCA a la de ejecución, porque la de ejecución
 * es la que decide y dejarle además subir documentos de clientes le daría al componente que decide
 * una capacidad que no necesita.
 */
type Clave = keyof typeof env;

const original = new Map<Clave, unknown>();

function poner(valores: Partial<Record<Clave, unknown>>): void {
  for (const [clave, valor] of Object.entries(valores) as Array<[Clave, unknown]>) {
    if (!original.has(clave)) original.set(clave, (env as Record<string, unknown>)[clave]);
    (env as Record<string, unknown>)[clave] = valor;
  }
}

function respuesta(cuerpo: unknown, estado = 200) {
  return { ok: estado >= 200 && estado < 300, status: estado, text: async () => JSON.stringify(cuerpo) };
}

const ENTRADA = { fileName: 'extracto.pdf', bytes: Buffer.from('%PDF-1.4'), correlationId: 'req-1' };

describe('BankStatementEngineClient', () => {
  let fetchMock: jest.Mock;
  let client: BankStatementEngineClient;

  beforeEach(() => {
    poner({
      DECISION_ENGINE_BASE_URL: 'http://motor:4000/',
      DECISION_ENGINE_STATEMENT_API_KEY: 'llave-extractos',
      DECISION_ENGINE_GOVERNANCE_API_KEY: 'llave-gobierno',
      DECISION_ENGINE_API_KEY: 'llave-ejecucion',
      DECISION_ENGINE_STATEMENT_MAX_WAIT_MS: 200,
      DECISION_ENGINE_STATEMENT_POLL_MS: 1,
      DECISION_ENGINE_STATEMENT_TIMEOUT_MS: 1000,
    });
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    client = new BankStatementEngineClient();
  });

  afterEach(() => {
    for (const [clave, valor] of original) (env as Record<string, unknown>)[clave] = valor;
    original.clear();
    jest.restoreAllMocks();
  });

  describe('configuración', () => {
    it('sin URL o sin llave no está configurado, y quien llame puede distinguirlo de un fallo', () => {
      expect(client.isConfigured).toBe(true);

      poner({ DECISION_ENGINE_STATEMENT_API_KEY: undefined, DECISION_ENGINE_GOVERNANCE_API_KEY: undefined });
      expect(client.isConfigured).toBe(false);

      poner({ DECISION_ENGINE_STATEMENT_API_KEY: 'k', DECISION_ENGINE_BASE_URL: undefined });
      expect(client.isConfigured).toBe(false);
    });

    it('sin configurar no se intenta la llamada: se declara indisponible', async () => {
      poner({ DECISION_ENGINE_BASE_URL: undefined });

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace.kind).toBe('engineUnavailable');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('la llave cae a la de GOBIERNO y nunca a la de ejecución', async () => {
      poner({ DECISION_ENGINE_STATEMENT_API_KEY: undefined });
      fetchMock.mockResolvedValue(respuesta({ requestId: 'r1', status: 'SUCCEEDED' }) as never);

      await client.analyze(ENTRADA);

      const cabeceras = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
      expect(cabeceras['x-api-key']).toBe('llave-gobierno');
      expect(cabeceras['x-api-key']).not.toBe('llave-ejecucion');
    });
  });

  describe('subida', () => {
    it('manda el PDF como formulario multiparte al endpoint del worker', async () => {
      fetchMock.mockResolvedValue(respuesta({ requestId: 'r1', status: 'SUCCEEDED' }) as never);

      await client.analyze(ENTRADA);

      const [url, opciones] = fetchMock.mock.calls[0] as [string, { method: string; body: FormData; headers: Record<string, string> }];
      expect(url).toBe('http://motor:4000/v1/workers/bank-statement/runs');
      expect(opciones.method).toBe('POST');
      expect(opciones.body).toBeInstanceOf(FormData);
      expect((opciones.body.get('file') as File).name).toBe('extracto.pdf');
    });

    it('la barra final de la URL base no produce una ruta con doble barra', async () => {
      poner({ DECISION_ENGINE_BASE_URL: 'http://motor:4000///' });
      fetchMock.mockResolvedValue(respuesta({ requestId: 'r1', status: 'SUCCEEDED' }) as never);

      await client.analyze(ENTRADA);

      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://motor:4000/v1/workers/bank-statement/runs');
    });

    it('lleva el tenant que exige el guardián del motor y propaga la correlación', async () => {
      fetchMock.mockResolvedValue(respuesta({ requestId: 'r1', status: 'SUCCEEDED' }) as never);

      await client.analyze(ENTRADA);

      const cabeceras = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
      expect(cabeceras['x-tenant-id']).toBe('1');
      expect(cabeceras['x-request-id']).toBe('req-1');
    });

    it('sin correlación no se inventa una cabecera vacía', async () => {
      fetchMock.mockResolvedValue(respuesta({ requestId: 'r1', status: 'SUCCEEDED' }) as never);

      await client.analyze({ fileName: 'a.pdf', bytes: Buffer.from('x') });

      const cabeceras = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
      expect(cabeceras).not.toHaveProperty('x-request-id');
    });
  });

  describe('un motor caído no es un extracto inválido', () => {
    it('un fallo de red al encolar es indisponibilidad, no rechazo', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED') as never);

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace.kind).toBe('engineUnavailable');
      expect(desenlace).toHaveProperty('reason', expect.stringContaining('ECONNREFUSED'));
    });

    it('un 5xx del motor tampoco descarta el documento', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ error: 'boom' }, 503) as never);

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace.kind).toBe('engineUnavailable');
      expect(desenlace).toHaveProperty('reason', expect.stringContaining('503'));
    });

    it('un fallo al sondear tampoco: el archivo ya está encolado', async () => {
      fetchMock
        .mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'QUEUED' }) as never)
        .mockRejectedValueOnce(new Error('socket hang up') as never);

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace.kind).toBe('engineUnavailable');
      expect(desenlace).toHaveProperty('reason', expect.stringContaining('socket hang up'));
    });

    it('agotar la espera NO cierra el caso: la ejecución sigue viva y el siguiente barrido la encuentra', async () => {
      fetchMock.mockResolvedValue(respuesta({ requestId: 'r1', status: 'RUNNING' }) as never);

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace.kind).toBe('engineUnavailable');
      expect(desenlace).toHaveProperty('reason', expect.stringContaining('RUNNING'));
    });

    it('que el motor termine en FAILED es una avería suya, no un veredicto sobre el documento', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'FAILED', errorMessage: 'OCR reventó' }) as never);

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace).toEqual({ kind: 'engineUnavailable', reason: 'OCR reventó' });
    });

    it('un CANCELLED sin mensaje declara al menos en qué estado terminó', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'CANCELLED' }) as never);

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace).toEqual({ kind: 'engineUnavailable', reason: 'El motor terminó en CANCELLED.' });
    });
  });

  describe('desenlaces del motor', () => {
    it('sondea hasta un estado terminal y devuelve el análisis', async () => {
      fetchMock
        .mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'QUEUED' }) as never)
        .mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'RUNNING' }) as never)
        .mockResolvedValueOnce(
          respuesta({ requestId: 'r1', status: 'SUCCEEDED', result: { affordability: { eligible: true, score: 72 } } }) as never,
        );

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace.kind).toBe('analyzed');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1]?.[0] as string).toBe('http://motor:4000/v1/workers/bank-statement/runs/r1');
      if (desenlace.kind === 'analyzed') expect(desenlace.run.result?.affordability?.score).toBe(72);
    });

    it('un análisis con advertencias sigue siendo un análisis', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'SUCCEEDED_WITH_WARNINGS' }) as never);

      await expect(client.analyze(ENTRADA)).resolves.toHaveProperty('kind', 'analyzed');
    });

    it('sólo `PDF_INVALID` es un rechazo, y llega con su motivo', async () => {
      fetchMock.mockResolvedValueOnce(
        respuesta({ requestId: 'r1', status: 'PDF_INVALID', rejectionReason: 'NOT_A_BANK_STATEMENT' }) as never,
      );

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace.kind).toBe('rejected');
      if (desenlace.kind === 'rejected') expect(desenlace.run.rejectionReason).toBe('NOT_A_BANK_STATEMENT');
    });

    it('los dos estados de revisión humana se declaran como revisión, no como rechazo', async () => {
      for (const estado of ['PENDING_REVIEW', 'IN_REVIEW']) {
        fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1', status: estado, reviewReason: 'AUTENTICIDAD' }) as never);

        const desenlace = await client.analyze(ENTRADA);

        expect(desenlace.kind).toBe('review');
        if (desenlace.kind === 'review') expect(desenlace.run.reviewReason).toBe('AUTENTICIDAD');
      }
    });

    it('un cuerpo sin estado se lee como encolado y no como éxito', async () => {
      fetchMock
        .mockResolvedValueOnce(respuesta({ requestId: 'r1' }) as never)
        .mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'SUCCEEDED' }) as never);

      const desenlace = await client.analyze(ENTRADA);

      expect(desenlace.kind).toBe('analyzed');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('los campos de texto ausentes o vacíos llegan como nulo, no como cadena vacía', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ requestId: 'r1', status: 'PDF_INVALID', rejectionReason: '', errorCode: null }) as never);

      const desenlace = await client.analyze(ENTRADA);

      if (desenlace.kind === 'rejected') {
        expect(desenlace.run.rejectionReason).toBeNull();
        expect(desenlace.run.errorCode).toBeNull();
        expect(desenlace.run.result).toBeNull();
      }
    });
  });
});
