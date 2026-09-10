import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';
import { env } from '../../../src/config/env.js';

/**
 * El cliente del Motor: la frontera por la que Atlas le pregunta y le cuenta cosas.
 *
 * Lo que se fija aquí son las cinco decisiones que, si se invierten, no lanzan ningún error y
 * cambian lo que el negocio ve: un rechazo de política convertido en «motor caído», una réplica de
 * consentimiento que tumba el recálculo que la llamó, una llave de ejecución usada para escribir la
 * medida del propio acierto, y una respuesta con forma desconocida aceptada como buena.
 */

type RespuestaFalsa = { status: number; body?: unknown; texto?: string };

const original = {
  base: env.DECISION_ENGINE_BASE_URL,
  api: env.DECISION_ENGINE_API_KEY,
  outcome: env.DECISION_ENGINE_OUTCOME_API_KEY,
  governance: env.DECISION_ENGINE_GOVERNANCE_API_KEY,
};

function configurar(over: Partial<typeof original> = {}) {
  const mutable = env as unknown as Record<string, unknown>;
  mutable.DECISION_ENGINE_BASE_URL = over.base ?? 'https://motor.atlas.local/';
  mutable.DECISION_ENGINE_API_KEY = over.api ?? 'llave-de-ejecucion';
  mutable.DECISION_ENGINE_OUTCOME_API_KEY = over.outcome ?? 'llave-de-desenlaces';
  mutable.DECISION_ENGINE_GOVERNANCE_API_KEY = over.governance ?? 'llave-de-gestion';
}

/** El ejecutor resiliente real reintenta y espera; aquí sólo interesa que propague. */
const ejecutorDirecto = { run: jest.fn(async (fn: () => Promise<unknown>) => fn()) };

function conFetch(...respuestas: RespuestaFalsa[]) {
  const llamadas: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const doble = jest.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url: String(url), init });
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: async () => r.texto ?? (r.body === undefined ? '' : JSON.stringify(r.body)),
      json: async () => r.body,
    } as unknown as Response;
  });
  (globalThis as unknown as { fetch: unknown }).fetch = doble;
  return { llamadas };
}

const decisionValida = {
  executionId: 'exec-1',
  status: 'COMPLETED',
  outcome: 'APPROVED',
  reasonCodes: [],
};

describe('DecisionEngineClient', () => {
  let fetchOriginal: typeof globalThis.fetch;

  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    ejecutorDirecto.run.mockClear();
    configurar();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    const mutable = env as unknown as Record<string, unknown>;
    mutable.DECISION_ENGINE_BASE_URL = original.base;
    mutable.DECISION_ENGINE_API_KEY = original.api;
    mutable.DECISION_ENGINE_OUTCOME_API_KEY = original.outcome;
    mutable.DECISION_ENGINE_GOVERNANCE_API_KEY = original.governance;
  });

  const cliente = () => new DecisionEngineClient(ejecutorDirecto as never);

  describe('estar configurado o no', () => {
    it('distingue «no hay integración» de «el motor falla»', () => {
      configurar();
      expect(cliente().isConfigured).toBe(true);

      configurar({ base: '' as never });
      expect(cliente().isConfigured).toBe(false);
    });

    /* Reportar desenlaces tiene su propia llave: sin ella no se reporta, aunque el motor responda. */
    it('reportar desenlaces depende de SU llave, no de la de ejecución', () => {
      configurar({ outcome: '' as never });
      expect(cliente().isConfigured).toBe(true);
      expect(cliente().canReportOutcomes).toBe(false);
    });
  });

  describe('execute', () => {
    it('llama al artefacto con la llave de ejecución y devuelve la decisión', async () => {
      const { llamadas } = conFetch({ status: 200, body: decisionValida });

      const respuesta = await cliente().execute('credit_underwriting', { subjectReference: 's1' } as never);

      expect(respuesta.executionId).toBe('exec-1');
      expect(llamadas[0].url).toBe('https://motor.atlas.local/v1/decisions/credit_underwriting');
      expect((llamadas[0].init?.headers as Record<string, string>)['x-api-key']).toBe('llave-de-ejecucion');
    });

    /*
     * El 422 es un desenlace de NEGOCIO —«la política rechaza»—, no un fallo de transporte. Tratarlo
     * como error lo mandaría al camino de reintentos y acabaría convertido en «motor no
     * disponible», borrando justo el rechazo que había que explicarle al cliente.
     */
    it('devuelve el 422 como respuesta válida, no como fallo', async () => {
      conFetch({ status: 422, body: { ...decisionValida, outcome: 'REJECTED', status: 'COMPLETED' } });

      const respuesta = await cliente().execute('credit_underwriting', { subjectReference: 's1' } as never);

      expect(respuesta.outcome).toBe('REJECTED');
    });

    /* Una forma que el core no reconoce es peor que un error: se colaría hasta la decisión. */
    it('rechaza una respuesta con forma desconocida en vez de aceptarla', async () => {
      conFetch({ status: 200, body: { noEsUnaDecision: true } });

      await expect(cliente().execute('credit_underwriting', { subjectReference: 's1' } as never)).rejects.toBeDefined();
    });

    it('sin URL configurada falla antes de salir a la red', async () => {
      configurar({ base: '' as never });
      const { llamadas } = conFetch({ status: 200, body: decisionValida });

      await expect(cliente().execute('x', {} as never)).rejects.toBeDefined();
      expect(llamadas).toHaveLength(0);
    });

    /* La barra final duplicada produciría `//v1/...`, que algunos proxies no normalizan. */
    it('normaliza la barra final de la URL base', async () => {
      configurar({ base: 'https://motor.atlas.local///' });
      const { llamadas } = conFetch({ status: 200, body: decisionValida });

      await cliente().execute('a', {} as never);

      expect(llamadas[0].url).toBe('https://motor.atlas.local/v1/decisions/a');
    });
  });

  describe('recordOutcomes', () => {
    /*
     * Va por el plano de GESTIÓN con su propia credencial: reutilizar aquí la llave de ejecución le
     * daría al componente que decide la capacidad de reescribir la medida de su propio acierto.
     */
    it('usa la llave de desenlaces, no la de ejecución', async () => {
      const { llamadas } = conFetch({ status: 200, body: {} });

      await cliente().recordOutcomes([{ executionId: 'e1' } as never]);

      expect(llamadas[0].url).toBe('https://motor.atlas.local/v1/model-monitoring/outcomes');
      expect((llamadas[0].init?.headers as Record<string, string>)['x-api-key']).toBe('llave-de-desenlaces');
    });

    it('no llama al motor con una lista vacía', async () => {
      const { llamadas } = conFetch({ status: 200, body: {} });

      await cliente().recordOutcomes([]);

      expect(llamadas).toHaveLength(0);
    });
  });

  describe('consentimientos', () => {
    /*
     * Es una RÉPLICA: el permiso ya está registrado y es válido donde vive el dato personal. Que
     * falle deja al motor sin enterarse, no al cliente sin derechos — tumbar por eso un recálculo
     * de línea cambiaría un problema de sincronización por uno de servicio.
     */
    it('un fallo al replicar no tumba a quien lo llamó', async () => {
      conFetch({ status: 500, body: { error: 'caído' } });

      await expect(
        cliente().recordConsent({ subjectReference: 's1', purpose: 'risk', basis: 'CONSENT', grantedAt: new Date() }),
      ).resolves.toBe(false);
    });

    it('replica con la llave de gestión y devuelve true al lograrlo', async () => {
      const { llamadas } = conFetch({ status: 200, body: {} });

      const ok = await cliente().recordConsent({
        subjectReference: 's1',
        purpose: 'risk',
        basis: 'CONSENT',
        grantedAt: new Date('2026-09-01T00:00:00.000Z'),
      });

      expect(ok).toBe(true);
      expect((llamadas[0].init?.headers as Record<string, string>)['x-api-key']).toBe('llave-de-gestion');
      expect(JSON.parse(String(llamadas[0].init?.body)).grantedAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('sin integración configurada no intenta replicar ni revocar', async () => {
      configurar({ base: '' as never });
      const { llamadas } = conFetch({ status: 200, body: {} });

      expect(await cliente().recordConsent({ subjectReference: 's', purpose: 'p', basis: 'CONSENT', grantedAt: new Date() })).toBe(false);
      expect(await cliente().revokeConsent({ subjectReference: 's', purpose: 'p' })).toBe(false);
      expect(llamadas).toHaveLength(0);
    });

    it('revocar tolera el fallo igual que registrar', async () => {
      conFetch({ status: 503, body: {} });

      await expect(cliente().revokeConsent({ subjectReference: 's1', purpose: 'risk' })).resolves.toBe(false);
    });
  });

  describe('lecturas: catálogo y caso de revisión', () => {
    /* Un fallo al leer no se reintenta ni tumba nada: la pantalla lo dice y se vuelve a intentar. */
    it('el catálogo devuelve lista vacía cuando el motor responde mal', async () => {
      conFetch({ status: 500, body: {} });

      await expect(cliente().listArtifacts()).resolves.toEqual([]);
    });

    it('el catálogo acepta el sobre `data`, el sobre `items` y la lista desnuda', async () => {
      conFetch({ status: 200, body: { data: [{ code: 'a' }] } });
      expect(await cliente().listArtifacts()).toEqual([{ code: 'a' }]);

      conFetch({ status: 200, body: { items: [{ code: 'b' }] } });
      expect(await cliente().listArtifacts()).toEqual([{ code: 'b' }]);

      conFetch({ status: 200, body: [{ code: 'c' }] });
      expect(await cliente().listArtifacts()).toEqual([{ code: 'c' }]);
    });

    it('el catálogo no revienta si el motor devuelve algo que no es una lista', async () => {
      conFetch({ status: 200, body: { data: { code: 'a' } } });

      await expect(cliente().listArtifacts()).resolves.toEqual([]);
    });

    /*
     * Es la vuelta del circuito: el motor abre el caso y una persona lo resuelve en SU cola, pero el
     * expediente vive en Atlas. Sin esto, un comercio aprobado por un analista seguía figurando «en
     * revisión» aquí para siempre.
     */
    it('el caso de revisión se lee con la llave de gestión y normaliza sus campos', async () => {
      const { llamadas } = conFetch({
        status: 200,
        body: {
          data: { caseCode: 'MRC-9', status: 'RESOLVED', resolutionJson: { decision: 'APPROVED' }, resolvedAt: '2026-09-08T10:00:00.000Z' },
        },
      });

      const caso = await cliente().getManualReviewCase('MRC-9');

      expect(caso).toEqual({
        caseCode: 'MRC-9',
        status: 'RESOLVED',
        resolution: { decision: 'APPROVED' },
        resolvedAt: '2026-09-08T10:00:00.000Z',
        assignedTo: null,
      });
      expect((llamadas[0].init?.headers as Record<string, string>)['x-api-key']).toBe('llave-de-gestion');
    });

    it('el caso devuelve null si el motor falla, para que el job reintente', async () => {
      conFetch({ status: 404, body: {} });

      await expect(cliente().getManualReviewCase('MRC-9')).resolves.toBeNull();
    });

    /* El código del caso puede traer caracteres que no son seguros en una URL. */
    it('escapa el código del caso en la URL', async () => {
      const { llamadas } = conFetch({ status: 200, body: {} });

      await cliente().getManualReviewCase('MRC/9 raro');

      expect(llamadas[0].url).toContain('MRC%2F9%20raro');
    });
  });

  /* Un cuerpo no-JSON no puede reventar el cliente: se conserva como texto y sigue el camino normal. */
  it('sobrevive a un cuerpo que no es JSON', async () => {
    conFetch({ status: 500, texto: '<html>502 Bad Gateway</html>' });

    await expect(cliente().execute('a', {} as never)).rejects.toBeDefined();
  });
});
