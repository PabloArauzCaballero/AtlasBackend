import { createHash } from 'node:crypto';
import { JourneyExecutor } from '../../../src/modules/qa-orchestration/application/journey-executor';
import type { QaTransport, TransportRequest } from '../../../src/modules/qa-orchestration/application/executor.ports';
import {
  PersonaUploadImages,
  uploadImageFor,
  type IdentityImagesPort,
} from '../../../src/modules/qa-orchestration/application/qa-upload-images';
import { CUSTOMER_ONBOARDING_SUBMISSION } from '../../../src/modules/qa-orchestration/catalog/customer-submission.recipes';
import { JOURNEY_TEMPLATES } from '../../../src/modules/qa-orchestration/catalog/journey-catalog';
import type { JourneyTemplate } from '../../../src/modules/qa-orchestration/domain/journey-recipe.types';
import { buildPersona, PERSONA_GENERATOR_VERSION } from '../../../src/modules/qa-orchestration/domain/persona-factory';
import { APELLIDOS, NOMBRES_F, NOMBRES_M } from '../../../src/modules/qa-orchestration/domain/persona-names';
import { uploadKindsOf, validateRecipe } from '../../../src/modules/qa-orchestration/domain/recipe-validation';
import { SYNTHETIC_UPLOAD_BYTES } from '../../../src/modules/qa-orchestration/fixtures/synthetic-upload';
import { MockControlClient, type MockIdentityImages } from '../../../src/modules/qa-orchestration/infrastructure/mock-control.client';

afterEach(() => jest.restoreAllMocks());

const REF_DATE = new Date('2026-09-24T12:00:00Z');
const persona = (ordinal = 1) => buildPersona({ masterSeed: 'semilla', ordinal, refDate: REF_DATE, runNamespace: 'qa-ns' });

/** Un «JPEG» del mock: bytes con su tamaño y hash declarados, como los devuelve el plano de control. */
function mockImage(label: string, size: number) {
  const bytes = Buffer.alloc(size, label.charCodeAt(0));
  return {
    contentType: 'image/jpeg',
    bytes: size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    base64: bytes.toString('base64'),
  };
}

const mockBody = () => ({
  version: 'identity-images@mock-1',
  images: { identity_front: mockImage('f', 20_000), identity_back: mockImage('b', 18_000), selfie: mockImage('s', 25_000) },
});

function fetchReturning(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

const client = () => new MockControlClient({ controlUrl: 'http://mock:4010/', controlToken: 'token-control' });
const mockPersona = {
  personaKey: 'p-0001',
  firstName: 'Wara',
  lastName: 'Quispe Mamani',
  documentNumber: '90001234',
  birthDate: '1990-01-02',
};

describe('cliente del mock: imágenes de identidad por persona', () => {
  it('pide a /mock/qa/identity-images con token y tenant, y comprueba tamaño y hash de cada imagen', async () => {
    const calls = fetchReturning(200, mockBody());
    const result = await client().identityImages('7', { ...mockPersona, sex: 'F', city: 'La Paz' });
    expect(calls[0].url).toBe('http://mock:4010/mock/qa/identity-images');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer token-control', 'x-mock-tenant-id': '7' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ ...mockPersona, sex: 'F', city: 'La Paz' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toBe('identity-images@mock-1');
    expect(result.images.selfie.bytes.length).toBe(25_000);
    expect(result.images.identity_front.sha256).toBe(mockBody().images.identity_front.sha256);
  });

  it.each([
    [404, { error: 'not found' }, 'HTTP_404'],
    [503, {}, 'HTTP_503'],
  ])('HTTP %s es un motivo, no una excepción', async (status, body, reason) => {
    fetchReturning(status, body);
    expect(await client().identityImages('7', mockPersona)).toEqual({ ok: false, reason });
  });

  it('una imagen cuyo hash o tamaño no cuadra, o que falta, no se acepta', async () => {
    const bad = mockBody();
    bad.images.selfie.sha256 = 'f'.repeat(64);
    fetchReturning(200, bad);
    expect(await client().identityImages('7', mockPersona)).toEqual({ ok: false, reason: 'SHA256_MISMATCH:selfie' });
    jest.restoreAllMocks();
    const short = mockBody();
    short.images.identity_back.bytes = 1;
    fetchReturning(200, short);
    expect(await client().identityImages('7', mockPersona)).toEqual({ ok: false, reason: 'SIZE_MISMATCH:identity_back' });
    jest.restoreAllMocks();
    fetchReturning(200, { version: 'x', images: { identity_front: mockBody().images.identity_front } });
    expect(await client().identityImages('7', mockPersona)).toEqual({ ok: false, reason: 'IMAGE_MISSING:identity_back' });
  });

  it('sin configuración no llama; con la red caída devuelve UNREACHABLE', async () => {
    const spy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await new MockControlClient({ controlUrl: undefined, controlToken: undefined }).identityImages('7', mockPersona)).toEqual({
      ok: false,
      reason: 'MOCK_NOT_CONFIGURED',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await client().identityImages('7', mockPersona)).toEqual({ ok: false, reason: 'UNREACHABLE' });
  });
});

function okImages(): MockIdentityImages {
  const image = (fill: number, size: number) => {
    const bytes = new Uint8Array(Buffer.alloc(size, fill));
    return { contentType: 'image/jpeg', bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  return {
    ok: true,
    version: 'v-mock',
    images: { identity_front: image(1, 20_000), identity_back: image(2, 18_000), selfie: image(3, 25_000) },
  };
}

describe('imágenes por persona dentro de una corrida', () => {
  const identityKinds = ['identity_front', 'identity_back', 'selfie'] as const;

  it('pide al mock UNA vez por persona y publica el tamaño real de cada imagen', async () => {
    const source: IdentityImagesPort = { identityImages: jest.fn(async () => okImages()) };
    const images = new PersonaUploadImages({ tenantId: '7', kinds: [...identityKinds, 'payment_qr'], source });
    const first = await images.forPersona(persona(1));
    const again = await images.forPersona(persona(1));
    expect(again).toBe(first);
    expect(source.identityImages).toHaveBeenCalledTimes(1);
    const p = persona(1);
    expect(source.identityImages).toHaveBeenCalledWith('7', {
      personaKey: p.personaKey,
      firstName: p.firstName,
      lastName: `${p.lastName} ${p.secondLastName}`,
      documentNumber: p.documentNumber,
      birthDate: p.birthDate,
      sex: p.sex,
      city: p.city,
    });
    expect(first.selfie).toMatchObject({ sizeBytes: 25_000, source: 'mock' });
    expect(first.identity_front?.bytes.length).toBe(first.identity_front?.sizeBytes);
    // El QR de cobro no lo dibuja el mock: sigue siendo el genérico del tamaño fijo.
    expect(first.payment_qr).toMatchObject({ sizeBytes: SYNTHETIC_UPLOAD_BYTES, source: 'fixture' });
    expect(images.summary()).toEqual({ mock: 1, fixture: 0, version: 'v-mock', fallbackReasons: {} });
  });

  it('sin mock (404, caído, sin configurar) cae a la genérica, avisa una sola vez y lo cuenta por motivo', async () => {
    const onFallback = jest.fn();
    const source: IdentityImagesPort = {
      identityImages: jest
        .fn<Promise<MockIdentityImages>, []>()
        .mockResolvedValueOnce({ ok: false, reason: 'HTTP_404' })
        .mockRejectedValueOnce(new Error('boom')),
    };
    const images = new PersonaUploadImages({ tenantId: '7', kinds: identityKinds, source, onFallback });
    const one = await images.forPersona(persona(1));
    await images.forPersona(persona(2));
    expect(one.identity_front).toMatchObject({ sizeBytes: SYNTHETIC_UPLOAD_BYTES, source: 'fixture' });
    expect(one.identity_front?.bytes.length).toBe(SYNTHETIC_UPLOAD_BYTES);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith({ personaKey: 'p-0001', reason: 'HTTP_404' });
    expect(images.summary()).toEqual({ mock: 0, fixture: 2, version: null, fallbackReasons: { HTTP_404: 1, 'ERROR:boom': 1 } });

    const unconfigured = new PersonaUploadImages({ tenantId: '7', kinds: identityKinds, source: null });
    await unconfigured.forPersona(persona(3));
    expect(unconfigured.summary()?.fallbackReasons).toEqual({ MOCK_NOT_CONFIGURED: 1 });
  });

  it('un aviso que falla no tumba la persona', async () => {
    const images = new PersonaUploadImages({
      tenantId: '7',
      kinds: identityKinds,
      source: null,
      onFallback: async () => Promise.reject(new Error('base caída')),
    });
    await expect(images.forPersona(persona(1))).resolves.toHaveProperty('selfie');
  });

  it('una receta sin imágenes de identidad no molesta al mock y no deja resumen', async () => {
    const source: IdentityImagesPort = { identityImages: jest.fn(async () => okImages()) };
    const images = new PersonaUploadImages({ tenantId: '7', kinds: ['payment_qr'], source });
    expect(Object.keys(await images.forPersona(persona(1)))).toEqual(['payment_qr']);
    expect(source.identityImages).not.toHaveBeenCalled();
    expect(images.summary()).toBeNull();
  });

  it('uploadImageFor usa la imagen resuelta y, si no la hay, la genérica', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(uploadImageFor({ uploads: { selfie: { bytes, sha256: 'abc', sizeBytes: 3, source: 'mock' } } }, 'selfie', 'p-0001')).toEqual({
      bytes,
      sha256: 'abc',
      source: 'mock',
    });
    const fallback = uploadImageFor({}, 'selfie', 'p-0001');
    expect(fallback.source).toBe('fixture');
    expect(fallback.bytes.length).toBe(SYNTHETIC_UPLOAD_BYTES);
  });
});

describe('recetas: el tamaño declarado sale de la imagen de la persona', () => {
  it('las recetas del catálogo siguen validando y declaran las imágenes que suben', () => {
    for (const template of JOURNEY_TEMPLATES) expect(validateRecipe(template)).toEqual([]);
    expect(uploadKindsOf(CUSTOMER_ONBOARDING_SUBMISSION)).toEqual(['identity_front', 'identity_back', 'selfie']);
  });

  it('sólo `uploads.<tipo>.sizeBytes` es legible por una receta: los bytes nunca van en un cuerpo', () => {
    const base = CUSTOMER_ONBOARDING_SUBMISSION;
    const withBody = (body: JourneyTemplate['steps'][number]['body']): JourneyTemplate => ({
      ...base,
      steps: [{ ...base.steps[0], body }],
    });
    expect(validateRecipe(withBody({ size: { $ref: 'uploads.selfie.sizeBytes' } })).map((b) => b.code)).not.toContain('BINDING_UNRESOLVED');
    expect(validateRecipe(withBody({ raw: { $ref: 'uploads.selfie.bytes' } })).map((b) => b.code)).toContain('BINDING_UNRESOLVED');
    expect(validateRecipe(withBody({ raw: { $ref: 'uploads.pasaporte.sizeBytes' } })).map((b) => b.code)).toContain('BINDING_UNRESOLVED');
  });

  it('el paso de URL firmada declara el tamaño de la imagen del mock y la subida manda esos mismos bytes', async () => {
    const calls: TransportRequest[] = [];
    const transport: QaTransport = {
      send: async (request) => {
        calls.push(request);
        return request.rawBody
          ? { status: 200, body: null, latencyMs: 1 }
          : { status: 201, body: { data: { uploadUrl: 'http://almacen.qa/o?firma=1', storageKey: 'k' } }, latencyMs: 1 };
      },
    };
    const steps = CUSTOMER_ONBOARDING_SUBMISSION.steps.filter((step) => step.stepKey.endsWith('_selfie'));
    const template: JourneyTemplate = { ...CUSTOMER_ONBOARDING_SUBMISSION, steps: steps.map((step) => ({ ...step, dependsOn: [] })) };
    const uploads = await new PersonaUploadImages({
      tenantId: '7',
      kinds: ['selfie'],
      source: { identityImages: async () => okImages() },
    }).forPersona(persona(1));
    const records = await new JourneyExecutor({
      transport,
      admission: { admit: async () => ({ admissionLagMs: 0 }) },
      budget: { acquire: async () => ({ ok: true as const, release: () => undefined }) },
      credential: { headerFor: () => ({}) },
      sink: { record: async () => undefined },
      sleep: async () => undefined,
    }).run({
      tenantId: '7',
      runId: '1',
      personaKey: 'p-0001',
      template,
      scope: { persona: persona(1), uploads, resources: { customerId: 'c-1' }, session: { customer: { accessToken: 'tok' } } },
      signal: new AbortController().signal,
      defaultTimeoutMs: 1_000,
    });
    expect(records.map((record) => record.status)).toEqual(['PASSED', 'PASSED']);
    expect((calls[0].body as { sizeBytes: number }).sizeBytes).toBe(25_000);
    expect(calls[1].rawBody?.length).toBe(25_000);
    expect(records[1].evidence.extracted).toMatchObject({ bytes: 25_000, imageSource: 'mock' });
  });
});

describe('personas sintéticas v2: nombres variados y coherentes', () => {
  it('pools de nombres por sexo y apellidos amplios, sin repetidos', () => {
    expect(PERSONA_GENERATOR_VERSION).toBe('persona-factory@2');
    expect(NOMBRES_F.length + NOMBRES_M.length).toBeGreaterThanOrEqual(60);
    expect(APELLIDOS.length).toBeGreaterThanOrEqual(60);
    for (const pool of [NOMBRES_F, NOMBRES_M, APELLIDOS]) expect(new Set(pool).size).toBe(pool.length);
    expect(NOMBRES_F.filter((name) => (NOMBRES_M as readonly string[]).includes(name))).toEqual([]);
  });

  it('determinista: misma semilla y ordinal, misma persona; el namespace no cambia el nombre', () => {
    const a = persona(7);
    expect(buildPersona({ masterSeed: 'semilla', ordinal: 7, refDate: REF_DATE, runNamespace: 'qa-ns' })).toEqual(a);
    const other = buildPersona({ masterSeed: 'semilla', ordinal: 7, refDate: REF_DATE, runNamespace: 'otro' });
    expect([other.sex, other.firstName, other.lastName, other.secondLastName]).toEqual([a.sex, a.firstName, a.lastName, a.secondLastName]);
    expect(other.documentNumber).not.toBe(a.documentNumber);
  });

  it('cien personas: sexo coherente con el nombre, dos apellidos distintos y variedad real', () => {
    const people = Array.from({ length: 100 }, (_, index) => persona(index + 1));
    for (const person of people) {
      expect((person.sex === 'F' ? (NOMBRES_F as readonly string[]) : (NOMBRES_M as readonly string[])).includes(person.firstName)).toBe(
        true,
      );
      expect(person.secondLastName).not.toBe(person.lastName);
      expect((APELLIDOS as readonly string[]).includes(person.secondLastName)).toBe(true);
    }
    expect(new Set(people.map((person) => person.sex))).toEqual(new Set(['F', 'M']));
    expect(new Set(people.map((person) => person.firstName)).size).toBeGreaterThan(40);
    expect(new Set(people.map((person) => `${person.firstName} ${person.lastName} ${person.secondLastName}`)).size).toBeGreaterThan(95);
  });
});
