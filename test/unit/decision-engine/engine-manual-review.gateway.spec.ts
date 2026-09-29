/**
 * @file El anexo del expediente del alta al caso del Motor: contrato HTTP y que nunca lance.
 * @business El caso de identidad en el portal del Motor tiene que recibir el expediente; si no llega, el alta sigue.
 * @system Ejercita `DecisionEngineClient.manualReviews.putOnboardingDossier` con el transporte real y `fetch` simulado.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';
import { ONBOARDING_DOSSIER_TIMEOUT_MS } from '../../../src/modules/decision-engine/engine-manual-review.gateway.js';
import { EngineTransportService } from '../../../src/modules/decision-engine/engine-transport.service.js';

const mutable = env as unknown as Record<string, unknown>;
const original = { base: env.DECISION_ENGINE_BASE_URL, api: env.DECISION_ENGINE_API_KEY, tenant: env.DECISION_ENGINE_TENANT_ID };

/** El circuito NO debe tocarse: si el anexo pasara por el ejecutor resiliente, esto fallaría. */
const ejecutor = { run: jest.fn(async () => Promise.reject(new Error('no debe usarse el circuito'))) };

function conFetch(respuesta: { status: number; body?: unknown } | Error) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init });
    if (respuesta instanceof Error) throw respuesta;
    return {
      status: respuesta.status,
      ok: respuesta.status >= 200 && respuesta.status < 300,
      text: async () => (respuesta.body === undefined ? '' : JSON.stringify(respuesta.body)),
    } as unknown as Response;
  });
  return llamadas;
}

function cliente() {
  return new DecisionEngineClient(new EngineTransportService(ejecutor as never));
}

const cuerpo = { dossier: { version: 1 }, openIfMissing: { queueCode: 'IDENTIDAD', motivo: 'REVISION_HUMANA_OBLIGATORIA' } };

describe('EngineManualReviewGateway.putOnboardingDossier', () => {
  let fetchOriginal: typeof globalThis.fetch;

  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    mutable.DECISION_ENGINE_BASE_URL = 'https://motor.atlas.local/';
    mutable.DECISION_ENGINE_API_KEY = 'llave-de-ejecucion';
    mutable.DECISION_ENGINE_TENANT_ID = 'tenant-motor';
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    mutable.DECISION_ENGINE_BASE_URL = original.base;
    mutable.DECISION_ENGINE_API_KEY = original.api;
    mutable.DECISION_ENGINE_TENANT_ID = original.tenant;
  });

  it('PUT a la ruta por ejecución, con la llave de EJECUCIÓN, el tenant del Motor y el cuerpo tal cual', async () => {
    const llamadas = conFetch({ status: 200, body: { data: { caseCode: 'MR-77', created: true, status: 'OPEN' } } });

    const resultado = await cliente().manualReviews.putOnboardingDossier('9001', cuerpo);

    expect(resultado).toEqual({ ok: true, status: 200, caseCode: 'MR-77', created: true });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.url).toBe('https://motor.atlas.local/v1/manual-reviews/by-execution/9001/onboarding-dossier');
    expect(llamadas[0]!.init.method).toBe('PUT');
    expect(llamadas[0]!.init.headers).toEqual({
      'x-tenant-id': 'tenant-motor',
      'content-type': 'application/json',
      'x-api-key': 'llave-de-ejecucion',
    });
    expect(JSON.parse(String(llamadas[0]!.init.body))).toEqual(cuerpo);
    expect(ejecutor.run).not.toHaveBeenCalled();
    expect(ONBOARDING_DOSSIER_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('acepta la respuesta sin envoltorio `data`', async () => {
    conFetch({ status: 200, body: { caseCode: 'MR-78', created: false } });

    await expect(cliente().manualReviews.putOnboardingDossier('9002', cuerpo)).resolves.toEqual({
      ok: true,
      status: 200,
      caseCode: 'MR-78',
      created: false,
    });
  });

  it.each([
    [404, { error: { code: 'MANUAL_REVIEW_NOT_FOUND' } }, 'MANUAL_REVIEW_NOT_FOUND', false],
    [404, { code: 'EXECUTION_NOT_FOUND' }, 'EXECUTION_NOT_FOUND', false],
    [409, { error: { code: 'MANUAL_REVIEW_CLOSED' } }, 'MANUAL_REVIEW_CLOSED', true],
    [413, { title: 'ONBOARDING_DOSSIER_TOO_LARGE' }, 'ONBOARDING_DOSSIER_TOO_LARGE', true],
    [503, undefined, 'HTTP 503', false],
  ])('un %d se devuelve como desenlace, sin lanzar', async (status, body, reason, final) => {
    conFetch({ status, body });

    await expect(cliente().manualReviews.putOnboardingDossier('9003', cuerpo)).resolves.toEqual({ ok: false, status, reason, final });
  });

  it('un fallo de red tampoco lanza', async () => {
    conFetch(new Error('connect ECONNREFUSED'));

    await expect(cliente().manualReviews.putOnboardingDossier('9004', cuerpo)).resolves.toEqual({
      ok: false,
      status: null,
      reason: 'connect ECONNREFUSED',
      final: false,
    });
  });

  it('sin Motor configurado no llama a nadie', async () => {
    mutable.DECISION_ENGINE_BASE_URL = undefined;
    const llamadas = conFetch({ status: 200 });

    await expect(cliente().manualReviews.putOnboardingDossier('9005', cuerpo)).resolves.toMatchObject({
      ok: false,
      reason: 'DECISION_ENGINE_NOT_CONFIGURED',
    });
    expect(llamadas).toHaveLength(0);
  });
});
