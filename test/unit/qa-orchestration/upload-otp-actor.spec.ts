import { createHash } from 'node:crypto';
import { JourneyExecutor } from '../../../src/modules/qa-orchestration/application/journey-executor';
import type { QaTransport, TransportRequest, TransportResponse } from '../../../src/modules/qa-orchestration/application/executor.ports';
import type { JourneyTemplate } from '../../../src/modules/qa-orchestration/domain/journey-recipe.types';
import { SYNTHETIC_UPLOAD_BYTES, syntheticImage } from '../../../src/modules/qa-orchestration/fixtures/synthetic-upload';
import { SYNTHETIC_IDENTITY_IMAGES } from '../../../src/modules/qa-orchestration/fixtures/synthetic-identity-images';
import { SYNTHETIC_QR_IMAGE } from '../../../src/modules/qa-orchestration/fixtures/synthetic-qr-image';
import { leerQrDeImagen } from '../../../src/common/images/qr-image-reader';
import { loginInternalActor } from '../../../src/modules/qa-orchestration/infrastructure/qa-internal-actor';

describe('imágenes sintéticas de identidad', () => {
  it('las fixtures versionadas coinciden con su checksum', () => {
    for (const image of [...Object.values(SYNTHETIC_IDENTITY_IMAGES), ...Object.values(SYNTHETIC_QR_IMAGE)]) {
      const bytes = Buffer.from(image.base64, 'base64');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256);
      expect(bytes.length).toBe(image.bytes);
    }
  });

  it('cada persona sube un JPEG válido, del tamaño firmado y con su propio hash', () => {
    const a = syntheticImage('identity_front', 'p-0001');
    const b = syntheticImage('identity_front', 'p-0002');
    expect(a.bytes.length).toBe(SYNTHETIC_UPLOAD_BYTES);
    expect([a.bytes[0], a.bytes[1], a.bytes[2], a.bytes[3]]).toEqual([0xff, 0xd8, 0xff, 0xfe]);
    expect(a.bytes[a.bytes.length - 2]).toBe(0xff);
    expect(a.bytes[a.bytes.length - 1]).toBe(0xd9);
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('el QR sintético sigue legible tras el comentario de la persona, y no es un QR de cobro real', () => {
    const { bytes } = syntheticImage('payment_qr', 'p-0001');
    expect(leerQrDeImagen(Buffer.from(bytes), 'image/jpeg')).toEqual({ ok: true, contenido: 'ATLAS-QA SINTETICO - NO ES UN QR DE COBRO' });
  });

  it('un tamaño que no cabe se rechaza en vez de truncar la imagen', () => {
    expect(() => syntheticImage('selfie', 'p-0001', 100)).toThrow('SYNTHETIC_UPLOAD_SIZE_INVALID');
  });
});

function executor(transport: QaTransport, inbox?: { latestCode: () => Promise<string | null> }) {
  return new JourneyExecutor({
    transport,
    inbox,
    admission: { admit: async () => ({ admissionLagMs: 0 }) },
    budget: { acquire: async () => ({ ok: true as const, release: () => undefined }) },
    credential: { headerFor: () => ({ 'x-atlas-qa-execution': 'firma' }) },
    sink: { record: async () => undefined },
    sleep: async () => undefined,
  });
}

const template = (steps: JourneyTemplate['steps']): JourneyTemplate => ({
  code: 't',
  version: '1',
  name: 't',
  description: 't',
  workflowCode: 'w',
  workflowVersion: 'v1',
  actors: ['anonymous'],
  scenarios: ['happy_path'],
  defaultScenario: 'happy_path',
  datasetModes: ['NORMAL_SYNTHETIC'],
  expectedTerminal: 't',
  status: 'READY',
  fixtures: [],
  steps,
});

const scope = () => ({
  persona: { email: 'qa@example.test' },
  resources: { url: 'http://almacen.qa/obj?firma=1' } as Record<string, unknown>,
  session: {} as Record<string, Record<string, unknown>>,
});

describe('paso de subida', () => {
  it('sube bytes reales a la URL firmada sin sesión ni credencial QA, y guarda su sha256', async () => {
    const calls: TransportRequest[] = [];
    const transport: QaTransport = { send: async (request) => (calls.push(request), { status: 200, body: null, latencyMs: 1 }) };
    const personaScope = scope();
    const [step] = await executor(transport).run({
      tenantId: '1',
      runId: 'r',
      personaKey: 'p-0001',
      template: template([
        {
          stepKey: 'up',
          method: 'PUT',
          path: '-',
          actor: 'anonymous',
          upload: { urlFrom: 'resources.url', image: 'selfie', extractSha256To: 'resources.sha' },
          expect: { status: [200] },
        },
      ]),
      scope: personaScope,
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(step.status).toBe('PASSED');
    expect(calls[0].absoluteUrl).toBe('http://almacen.qa/obj?firma=1');
    expect(calls[0].rawBody?.length).toBe(SYNTHETIC_UPLOAD_BYTES);
    expect(calls[0].headers).toEqual({ 'content-type': 'image/jpeg' });
    expect(personaScope.resources.sha).toBe(syntheticImage('selfie', 'p-0001').sha256);
    expect(JSON.stringify(step.evidence)).not.toContain('firma=1');
  });

  it('un almacenamiento que rechaza la subida hace fallar el paso', async () => {
    const transport: QaTransport = { send: async (): Promise<TransportResponse> => ({ status: 403, body: null, latencyMs: 1 }) };
    const [step] = await executor(transport).run({
      tenantId: '1',
      runId: 'r',
      personaKey: 'p-0001',
      template: template([
        {
          stepKey: 'up',
          method: 'PUT',
          path: '-',
          actor: 'anonymous',
          upload: { urlFrom: 'resources.url', image: 'selfie', extractSha256To: 'resources.sha' },
          expect: { status: [200] },
        },
      ]),
      scope: scope(),
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(step.status).toBe('FAILED');
  });
});

describe('paso de código desde el buzón QA', () => {
  const otpTemplate = template([
    {
      stepKey: 'code',
      method: 'GET',
      path: '-',
      actor: 'anonymous',
      otp: { channel: 'email', toFrom: 'persona.email', extractTo: 'session.otp.code', deadlineMs: 10 },
      expect: { status: [200] },
    },
  ]);
  const noTransport: QaTransport = { send: async () => ({ status: 500, body: null, latencyMs: 0 }) };

  it('guarda el código en la sesión y nunca en la evidencia', async () => {
    const personaScope = scope();
    const [step] = await executor(noTransport, { latestCode: async () => '693643' }).run({
      tenantId: '1',
      runId: 'r',
      personaKey: 'p-0001',
      template: otpTemplate,
      scope: personaScope,
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(step.status).toBe('PASSED');
    expect(personaScope.session.otp.code).toBe('693643');
    expect(JSON.stringify(step)).not.toContain('693643');
  });

  it('sin código en el plazo falla con motivo; sin buzón también', async () => {
    const [late] = await executor(noTransport, { latestCode: async () => null }).run({
      tenantId: '1',
      runId: 'r',
      personaKey: 'p-0001',
      template: otpTemplate,
      scope: scope(),
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(late.status).toBe('FAILED');
    const [none] = await executor(noTransport).run({
      tenantId: '1',
      runId: 'r',
      personaKey: 'p-0001',
      template: otpTemplate,
      scope: scope(),
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(none.reason).toMatch(/buzón/);
  });
});

describe('sesión tomada de una cookie', () => {
  it('la cookie va a la sesión del actor y nunca a recursos ni a la evidencia', async () => {
    const transport: QaTransport = {
      send: async () => ({ status: 200, body: { data: {} }, latencyMs: 1, cookies: { atlas_internal_access: 'tok-comercio' } }),
    };
    const personaScope = scope();
    const [step] = await executor(transport).run({
      tenantId: '1',
      runId: 'r',
      personaKey: 'p-0001',
      template: template([
        {
          stepKey: 'login',
          method: 'POST',
          path: '/merchant/auth/login',
          actor: 'anonymous',
          body: {},
          expect: { status: [200] },
          extract: [
            { to: 'session.merchant_user.accessToken', from: 'cookies.atlas_internal_access', required: true },
            { to: 'resources.leak', from: 'cookies.atlas_internal_access' },
          ],
        },
      ]),
      scope: personaScope,
      signal: new AbortController().signal,
      defaultTimeoutMs: 1000,
    });
    expect(step.status).toBe('PASSED');
    expect(personaScope.session.merchant_user.accessToken).toBe('tok-comercio');
    expect(personaScope.resources.leak).toBeUndefined();
    expect(JSON.stringify(step)).not.toContain('tok-comercio');
  });
});

describe('login del operador interno QA', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('toma la sesión de la cookie y la devuelve como token', async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ data: { user: {} } }), {
        status: 200,
        headers: [['set-cookie', 'atlas_internal_access=tok-123; Path=/; HttpOnly']],
      })) as typeof fetch;
    expect(await loginInternalActor({ baseUrl: 'http://api', tenantId: '1', email: 'qa@example.test', password: 'x' })).toEqual({
      ok: true,
      accessToken: 'tok-123',
    });
  });

  it('con PIN exigido no hay actor: el segundo factor no se salta', async () => {
    global.fetch = (async () => new Response(JSON.stringify({ data: { pinChallengeRequired: true } }), { status: 200 })) as typeof fetch;
    const result = await loginInternalActor({ baseUrl: 'http://api', tenantId: '1', email: 'qa@example.test', password: 'x' });
    expect(result.ok).toBe(false);
  });

  it('credenciales malas o red caída devuelven un motivo, no una excepción', async () => {
    global.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    expect((await loginInternalActor({ baseUrl: 'http://api', tenantId: '1', email: 'a', password: 'b' })).ok).toBe(false);
    global.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect(await loginInternalActor({ baseUrl: 'http://api', tenantId: '1', email: 'a', password: 'b' })).toEqual({
      ok: false,
      message: expect.stringContaining('ECONNREFUSED'),
    });
  });
});
