import { afterEach, describe, expect, it, jest } from '@jest/globals';

/**
 * Probe HTTP de los dos backends hermanos del ecosistema (motor de decisión y ERP), que el panel de
 * sistemas del portal interno usa para decir si están en pie.
 *
 * Lo que se protege aquí es la DISTINCIÓN entre los tres desenlaces, porque cada uno pide una
 * acción distinta de quien mira el panel: «nadie configuró dónde buscarlo» es un hueco de
 * despliegue, «contestó 503» es el servicio despierto pero enfermo, y «no contestó» es el servicio
 * ausente. Colapsar los tres en un rojo genérico manda a operaciones a buscar en el sitio
 * equivocado, y el caso de la configuración ausente es el peligroso: leerlo como caída dispara una
 * guardia por un servicio que quizá está perfectamente sano.
 */
type ProbeModule = typeof import('../../src/modules/systems-ops/platform-service-health.probe.js');

const BASE_ENV = {
  DECISION_ENGINE_BASE_URL: undefined as string | undefined,
  DECISION_ENGINE_HEALTH_BASE_URL: undefined as string | undefined,
  DECISION_ENGINE_HEALTH_PATH: '/health',
  DECISION_ENGINE_TIMEOUT_MS: 10_000,
  ERP_BACKEND_BASE_URL: undefined as string | undefined,
  ERP_BACKEND_HEALTH_PATH: '/api/v1/health',
  ERP_BACKEND_TIMEOUT_MS: 5_000,
};

async function loadProbe(overrides: Partial<typeof BASE_ENV> = {}): Promise<ProbeModule> {
  jest.resetModules();
  jest.doMock('../../src/config/env.js', () => ({ env: { ...BASE_ENV, ...overrides } }));
  return import('../../src/modules/systems-ops/platform-service-health.probe.js');
}

function mockFetch(impl: () => Promise<unknown>): void {
  (globalThis as { fetch: unknown }).fetch = jest.fn(impl as never) as never;
}

describe('probePlatformService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('devuelve null para códigos que no son servicios hermanos, para no secuestrar otros chequeos', async () => {
    const { probePlatformService } = await loadProbe();
    expect(await probePlatformService('POSTGRES')).toBeNull();
  });

  it('sin dirección configurada no dice "caído": dice que nadie ha dicho dónde buscarlo', async () => {
    const { probePlatformService } = await loadProbe();
    const result = await probePlatformService('ERP_BACKEND');
    expect(result).toMatchObject({ checkType: 'CONFIGURATION', isHealthy: false });
    expect(result?.healthMessage).toContain('no tiene dirección configurada');
    // La frase que impide confundir el hueco de despliegue con una caída real.
    expect(result?.healthMessage).toContain('No es lo mismo que estar caído');
  });

  it('reporta sano cuando el healthcheck responde 2xx, con la URL consultada', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    const { probePlatformService } = await loadProbe({ ERP_BACKEND_BASE_URL: 'http://erp.local' });
    const result = await probePlatformService('ERP_BACKEND');
    expect(result).toMatchObject({ checkType: 'LIVE', isHealthy: true });
    expect(result?.healthMessage).toContain('http://erp.local/api/v1/health');
  });

  it('un HTTP no-2xx es LIVE pero enfermo, y nombra el estado devuelto', async () => {
    mockFetch(async () => ({ ok: false, status: 503 }));
    const { probePlatformService } = await loadProbe({ ERP_BACKEND_BASE_URL: 'http://erp.local' });
    const result = await probePlatformService('ERP_BACKEND');
    expect(result).toMatchObject({ checkType: 'LIVE', isHealthy: false });
    expect(result?.healthMessage).toContain('HTTP 503');
  });

  it('un fallo de red se reporta con el motivo, no con un rojo mudo', async () => {
    mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const { probePlatformService } = await loadProbe({ ERP_BACKEND_BASE_URL: 'http://erp.local' });
    const result = await probePlatformService('ERP_BACKEND');
    expect(result).toMatchObject({ checkType: 'LIVE', isHealthy: false });
    expect(result?.healthMessage).toContain('ECONNREFUSED');
  });

  it('el timeout se distingue del rechazo de conexión y nombra el límite superado', async () => {
    mockFetch(async () => {
      const abort = new Error('The operation was aborted');
      abort.name = 'AbortError';
      throw abort;
    });
    const { probePlatformService } = await loadProbe({
      ERP_BACKEND_BASE_URL: 'http://erp.local',
      ERP_BACKEND_TIMEOUT_MS: 1_234,
    });
    const result = await probePlatformService('ERP_BACKEND');
    expect(result?.healthMessage).toContain('no respondió en 1234 ms');
  });

  it('explica qué se degrada: el motor manda el crédito a revisión manual, el ERP sólo pierde visibilidad', async () => {
    mockFetch(async () => ({ ok: false, status: 500 }));
    const motor = await loadProbe({ DECISION_ENGINE_HEALTH_BASE_URL: 'http://motor.local' });
    const motorResult = await motor.probePlatformService('DECISION_ENGINE');
    expect(motorResult?.healthMessage).toContain('revisión manual');

    mockFetch(async () => ({ ok: false, status: 500 }));
    const erp = await loadProbe({ ERP_BACKEND_BASE_URL: 'http://erp.local' });
    const erpResult = await erp.probePlatformService('ERP_BACKEND');
    expect(erpResult?.healthMessage).toContain('no se degrada');
  });

  it('si la integración real está configurada, su BASE_URL manda sobre la de sólo-observabilidad', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    const { probePlatformService } = await loadProbe({
      DECISION_ENGINE_BASE_URL: 'http://integracion.local',
      DECISION_ENGINE_HEALTH_BASE_URL: 'http://solo-salud.local',
    });
    const result = await probePlatformService('DECISION_ENGINE');
    expect(result?.healthMessage).toContain('http://integracion.local/health');
    expect(result?.healthMessage).not.toContain('solo-salud');
  });

  it('no duplica ni pierde barras al componer la URL', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    const { probePlatformService } = await loadProbe({
      ERP_BACKEND_BASE_URL: 'http://erp.local/',
      ERP_BACKEND_HEALTH_PATH: '/api/v1/health',
    });
    const result = await probePlatformService('ERP_BACKEND');
    expect(result?.healthMessage).toContain('http://erp.local/api/v1/health');
  });
});
