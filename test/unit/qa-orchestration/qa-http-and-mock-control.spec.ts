import { MockControlClient } from '../../../src/modules/qa-orchestration/infrastructure/mock-control.client';
import {
  abortableSleep,
  BucketAdmission,
  QaHttpTransport,
  RunBudget,
} from '../../../src/modules/qa-orchestration/infrastructure/qa-http-actor';
import type { TransportRequest } from '../../../src/modules/qa-orchestration/application/executor.ports';

type FetchCall = { url: string; init: RequestInit };

/** `fetch` simulado: registra la llamada y responde lo que diga el manejador. */
function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  return { calls, spy };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Una petición que no responde nunca y sólo termina cuando su señal se aborta, como `fetch`. */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
  });

afterEach(() => jest.restoreAllMocks());

const request = (overrides: Partial<TransportRequest> = {}): TransportRequest => ({
  method: 'GET',
  path: '/auth/me',
  headers: { authorization: 'Bearer tok' },
  timeoutMs: 1_000,
  signal: new AbortController().signal,
  ...overrides,
});

describe('transporte HTTP del worker QA', () => {
  it('fija el tenant, junta la consulta, no manda cuerpo en GET y lee el JSON', async () => {
    const http = mockFetch(() => json({ data: { ok: true } }));
    const response = await new QaHttpTransport('http://qa.local/api/v1///', '7').send(request({ query: { a: '1', b: 'x y' } }));
    expect(response).toMatchObject({ status: 200, body: { data: { ok: true } } });
    expect(http.calls[0].url).toBe('http://qa.local/api/v1/auth/me?a=1&b=x+y');
    expect(http.calls[0].init.body).toBeUndefined();
    expect(http.calls[0].init.headers).toMatchObject({
      'x-tenant-id': '7',
      authorization: 'Bearer tok',
      'content-type': 'application/json',
    });
  });

  it('POST serializa el cuerpo; una respuesta no JSON se recorta como evidencia', async () => {
    const http = mockFetch(() => new Response('<html>'.padEnd(300, 'x'), { status: 502 }));
    const response = await new QaHttpTransport('http://qa.local', '7').send(request({ method: 'POST', body: { a: 1 } }));
    expect(http.calls[0].init.body).toBe('{"a":1}');
    expect(response.status).toBe(502);
    expect((response as { body: { nonJsonBody: string } }).body.nonJsonBody).toHaveLength(200);
  });

  it('las Set-Cookie de la respuesta llegan como cookies (sesión de comercio en cookie)', async () => {
    mockFetch(
      () =>
        new Response('{}', {
          status: 200,
          headers: [
            ['set-cookie', 'atlas_internal_access=tok=con=igual; Path=/; HttpOnly'],
            ['set-cookie', 'otra=1'],
            ['set-cookie', 'rota'],
          ],
        }),
    );
    const response = await new QaHttpTransport('http://qa.local', '7').send(request({ method: 'POST', body: {} }));
    expect(response).toMatchObject({ cookies: { atlas_internal_access: 'tok=con=igual', otra: '1' } });
  });

  it('un cuerpo vacío es null y DELETE tampoco lleva cuerpo', async () => {
    const http = mockFetch(() => new Response('', { status: 200 }));
    const response = await new QaHttpTransport('http://qa.local', '7').send(request({ method: 'DELETE', body: { a: 1 } }));
    expect(response).toMatchObject({ status: 200, body: null });
    expect(http.calls[0].init.body).toBeUndefined();
  });

  it('sin respuesta dentro del plazo es TIMEOUT', async () => {
    mockFetch(hang);
    const response = await new QaHttpTransport('http://qa.local', '7').send(request({ timeoutMs: 10 }));
    expect(response).toMatchObject({ status: null, error: 'TIMEOUT' });
  });

  it('abortar la corrida es CANCELLED, no un timeout', async () => {
    mockFetch(hang);
    const controller = new AbortController();
    const pending = new QaHttpTransport('http://qa.local', '7').send(request({ timeoutMs: 60_000, signal: controller.signal }));
    controller.abort('CANCELLED');
    expect(await pending).toMatchObject({ status: null, error: 'CANCELLED' });
  });

  it('un error de red conserva su mensaje', async () => {
    mockFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(await new QaHttpTransport('http://qa.local', '7').send(request())).toMatchObject({ status: null, error: 'ECONNREFUSED' });
  });
});

describe('presupuesto de la corrida', () => {
  const lejos = () => Date.now() + 60_000;

  it('agotado el total no sale ni una petición más', async () => {
    const budget = new RunBudget({ maxRequests: 1, maxInFlightRequests: 5, deadlineAt: lejos() }, new AbortController().signal);
    const primera = await budget.acquire();
    expect(primera.ok).toBe(true);
    expect(await budget.acquire()).toEqual({ ok: false, reason: 'BUDGET_EXHAUSTED' });
    expect(budget.requestsIssued).toBe(1);
    expect(budget.exhausted).toBe('BUDGET_EXHAUSTED');
  });

  it('vencido el plazo, DEADLINE_EXCEEDED; cancelada la corrida, CANCELLED', async () => {
    const vencido = new RunBudget({ maxRequests: 10, maxInFlightRequests: 5, deadlineAt: Date.now() - 1 }, new AbortController().signal);
    expect(await vencido.acquire()).toEqual({ ok: false, reason: 'DEADLINE_EXCEEDED' });

    const controller = new AbortController();
    controller.abort();
    const cancelado = new RunBudget({ maxRequests: 10, maxInFlightRequests: 5, deadlineAt: lejos() }, controller.signal);
    expect(await cancelado.acquire()).toEqual({ ok: false, reason: 'CANCELLED' });
    expect(cancelado.exhausted).toBeNull();
  });

  it('con el máximo en vuelo, la siguiente espera a que se libere un cupo (y liberar dos veces no cuenta doble)', async () => {
    const budget = new RunBudget({ maxRequests: 10, maxInFlightRequests: 1, deadlineAt: lejos() }, new AbortController().signal);
    const primera = await budget.acquire();
    let segundaObtenida = false;
    const segunda = budget.acquire().then((result) => {
      segundaObtenida = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(segundaObtenida).toBe(false);
    if (!primera.ok) throw new Error('la primera debía obtener cupo');
    primera.release();
    primera.release();
    const obtenida = await segunda;
    expect(obtenida.ok).toBe(true);
    expect(budget.requestsIssued).toBe(2);
    // El doble release no abrió un segundo cupo: la tercera vuelve a esperar.
    let terceraObtenida = false;
    void budget.acquire().then(() => (terceraObtenida = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(terceraObtenida).toBe(false);
    budget.wakeAll();
  });

  it('wakeAll despierta a quien espera para que vea la cancelación', async () => {
    const controller = new AbortController();
    const budget = new RunBudget({ maxRequests: 10, maxInFlightRequests: 1, deadlineAt: lejos() }, controller.signal);
    await budget.acquire();
    const esperando = budget.acquire();
    controller.abort();
    budget.wakeAll();
    expect(await esperando).toEqual({ ok: false, reason: 'CANCELLED' });
  });
});

describe('admisión por cubo y espera abortable', () => {
  it('el mismo cubo se comparte: la segunda admisión con cupo 1/min hace cola hasta que se aborta', async () => {
    const admission = new BucketAdmission();
    expect((await admission.admit('onboarding_start', 1, new AbortController().signal)).admissionLagMs).toBeLessThan(50);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const segunda = await admission.admit('onboarding_start', 1, controller.signal);
    expect(segunda.admissionLagMs).toBeGreaterThanOrEqual(20);
    // Otro cubo no comparte la ficha gastada.
    expect((await admission.admit('auth_login', 1, new AbortController().signal)).admissionLagMs).toBeLessThan(50);
  });

  it('un cupo 0 se trata como 1, no como «nunca»', async () => {
    const lag = (await new BucketAdmission().admit('x', 0, new AbortController().signal)).admissionLagMs;
    expect(lag).toBeLessThan(50);
  });

  it('abortableSleep termina al vencer, al abortar o de inmediato si ya estaba abortada', async () => {
    const inicio = Date.now();
    await abortableSleep(15, new AbortController().signal);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(10);

    const controller = new AbortController();
    const larga = abortableSleep(60_000, controller.signal);
    controller.abort();
    await larga;

    const abortada = new AbortController();
    abortada.abort();
    await abortableSleep(60_000, abortada.signal);
  });
});

describe('cliente del plano de control del mock', () => {
  const client = (overrides: { controlUrl?: string; controlToken?: string } = {}) =>
    new MockControlClient({ controlUrl: 'http://mock.local/', controlToken: 'admin-token', ...overrides });

  it('configurado sólo con URL y token', () => {
    expect(client().configured).toBe(true);
    expect(client({ controlToken: '' }).configured).toBe(false);
    expect(new MockControlClient({ controlUrl: undefined, controlToken: 'x' }).configured).toBe(false);
  });

  it('capabilities arma la matriz por proveedor con sólo los escenarios soportados', async () => {
    const http = mockFetch(() =>
      json({
        schemaVersion: '2026-09',
        providers: [
          {
            code: 'segip',
            scenarioMatrix: [{ scenario: 'happy_path', supported: true }, { scenario: 'timeout', supported: false }, { supported: true }],
          },
          { code: 'asfi' },
          { scenarioMatrix: [{ scenario: 'x', supported: true }] },
        ],
      }),
    );
    expect(await client().capabilities()).toEqual({
      reachable: true,
      schemaVersion: '2026-09',
      scenarios: { SEGIP: ['happy_path'], ASFI: [] },
    });
    expect(http.calls[0].url).toBe('http://mock.local/mock/providers');
    expect(http.calls[0].init.headers).toMatchObject({ authorization: 'Bearer admin-token' });
    expect(http.calls[0].init.headers).not.toHaveProperty('x-mock-tenant-id');
  });

  it('capabilities: sin URL, con error HTTP o sin red no inventa escenarios', async () => {
    expect(await new MockControlClient({ controlUrl: undefined, controlToken: undefined }).capabilities()).toEqual({
      reachable: false,
      schemaVersion: null,
      scenarios: null,
    });
    mockFetch(() => new Response('no es json', { status: 503 }));
    expect(await client().capabilities()).toEqual({ reachable: true, schemaVersion: null, scenarios: null });
    jest.restoreAllMocks();
    mockFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(await client().capabilities()).toEqual({ reachable: false, schemaVersion: null, scenarios: null });
  });

  it('openRun abre el namespace con el tenant en cabecera y la versión de fixtures', async () => {
    const http = mockFetch(() => json({ runToken: 'rt-1', epoch: 'e-1' }, 201));
    expect(await client().openRun({ tenantId: '7', runId: 'qa-ns', seed: 's', scenarioProfile: 'happy_path' })).toEqual({
      runToken: 'rt-1',
      epoch: 'e-1',
    });
    expect(http.calls[0].init.method).toBe('POST');
    expect(http.calls[0].init.headers).toMatchObject({ 'x-mock-tenant-id': '7' });
    expect(JSON.parse(String(http.calls[0].init.body))).toEqual({
      tenantId: '7',
      runId: 'qa-ns',
      seed: 's',
      scenarioProfile: 'happy_path',
      fixtureVersion: 'qa-orchestration@1',
    });
  });

  it('openRun falla con el código del mock, o «sin código» si no hay token', async () => {
    mockFetch(() => json({ error: { code: 'RUN_EXISTS' } }, 409));
    await expect(client().openRun({ tenantId: '7', runId: 'qa-ns', seed: 's', scenarioProfile: 'p' })).rejects.toThrow(
      'MOCK_RUN_NOT_CREATED:409:RUN_EXISTS',
    );
    jest.restoreAllMocks();
    mockFetch(() => json({ code: 'FORBIDDEN' }, 403));
    await expect(client().openRun({ tenantId: '7', runId: 'qa-ns', seed: 's', scenarioProfile: 'p' })).rejects.toThrow(
      'MOCK_RUN_NOT_CREATED:403:FORBIDDEN',
    );
    jest.restoreAllMocks();
    mockFetch(() => json({ epoch: 'e' }, 201));
    await expect(client().openRun({ tenantId: '7', runId: 'qa-ns', seed: 's', scenarioProfile: 'p' })).rejects.toThrow(
      'MOCK_RUN_NOT_CREATED:201:sin código',
    );
  });

  it('readJournal recorre el cursor hasta hasMore=false y concatena las páginas', async () => {
    const http = mockFetch((url) =>
      url.includes('after=0')
        ? json({ entries: [{ sequence: 1 }, { sequence: 2 }], hasMore: true, nextCursor: 2, totalAppended: 3, droppedByRetention: 0 })
        : json({ entries: [{ sequence: 3 }], hasMore: false, totalAppended: 3, droppedByRetention: 0 }),
    );
    const journal = await client().readJournal('7', 'qa ns/1');
    expect(journal).toEqual({
      entries: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }],
      totalAppended: 3,
      droppedByRetention: 0,
      complete: true,
    });
    expect(http.calls.map((call) => call.url)).toEqual([
      'http://mock.local/mock/control/runs/qa%20ns%2F1/journal?after=0&limit=1000',
      'http://mock.local/mock/control/runs/qa%20ns%2F1/journal?after=2&limit=1000',
    ]);
  });

  it('un journal con entradas descartadas por retención no certifica: complete=false', async () => {
    mockFetch(() => json({ entries: [{ sequence: 9 }], hasMore: false, totalAppended: 9, droppedByRetention: 8 }));
    expect(await client().readJournal('7', 'qa-ns')).toMatchObject({ droppedByRetention: 8, complete: false });
  });

  it('agotadas las páginas sin llegar al final, tampoco es completo; un error HTTP es null', async () => {
    mockFetch(() => json({ entries: [{ sequence: 1 }], hasMore: true, totalAppended: 5, droppedByRetention: 0 }));
    expect(await client().readJournal('7', 'qa-ns', 2)).toEqual({
      entries: [{ sequence: 1 }, { sequence: 1 }],
      totalAppended: 5,
      droppedByRetention: 0,
      complete: false,
    });
    jest.restoreAllMocks();
    mockFetch(() => json({ error: 'nope' }, 404));
    expect(await client().readJournal('7', 'qa-ns')).toBeNull();
  });

  it('closeRun borra el namespace y se traga los errores de red', async () => {
    const http = mockFetch(() => new Response(null, { status: 204 }));
    await client().closeRun('7', 'qa-ns');
    expect(http.calls[0]).toMatchObject({ url: 'http://mock.local/mock/control/runs/qa-ns', init: { method: 'DELETE' } });
    jest.restoreAllMocks();
    mockFetch(() => Promise.reject(new Error('ECONNRESET')));
    await expect(client().closeRun('7', 'qa-ns')).resolves.toBeUndefined();
  });

  it('una llamada colgada se aborta a los timeoutMs', async () => {
    mockFetch(hang);
    const lento = new MockControlClient({ controlUrl: 'http://mock.local', controlToken: 't', timeoutMs: 10 });
    expect(await lento.capabilities()).toEqual({ reachable: false, schemaVersion: null, scenarios: null });
  });
});
