import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from '../../../src/common/pipes/zod-validation.pipe.js';
import { CAPTURE_SOURCES } from '../../../src/common/storage/capture-source.js';
import { uploadUrlRequestSchema } from '../../../src/modules/customer-onboarding/customer-onboarding-profile.schemas.js';
import { identityPackageSchema } from '../../../src/modules/customer-onboarding/customer-onboarding.schemas.js';

/**
 * El origen de la captura (`camera` | `system_scanner`) en el borde del alta.
 *
 * Tres propiedades, las mismas en los dos esquemas:
 * 1. **Sin el campo, igual que hoy.** Una app anterior al escáner no lo manda y no puede notar nada.
 * 2. **Con un valor válido, pasa tal cual.** Es lo que termina en `evidence_documents.capture_source`.
 * 3. **Con un valor inventado, 400.** La columna tiene CHECK: dejarlo pasar lo convertiría en un 500
 *    dentro de la transacción del paquete de identidad.
 *
 * `uploadUrlRequestSchema` es `.strict()`: antes de declarar el campo, mandarlo daba 400. Por eso la
 * app sólo lo manda con la bandera del escáner encendida, que se enciende después de este despliegue.
 */
const pipe = (schema: ConstructorParameters<typeof ZodValidationPipe>[0]) => new ZodValidationPipe(schema);
const validar = (schema: ConstructorParameters<typeof ZodValidationPipe>[0], body: unknown) =>
  pipe(schema).transform(body, { type: 'body' });

describe('uploadUrlRequestSchema · captureSource', () => {
  const base = { documentType: 'identity_front', contentType: 'image/jpeg', sizeBytes: 1_000 };

  it('sin captureSource, el cuerpo sale idéntico al de antes', () => {
    expect(validar(uploadUrlRequestSchema, base)).toEqual(base);
  });

  it.each(CAPTURE_SOURCES)('acepta %s', (origen) => {
    expect(validar(uploadUrlRequestSchema, { ...base, captureSource: origen })).toEqual({ ...base, captureSource: origen });
  });

  it.each(['gallery', 'CAMERA', '', null, 1])('rechaza %p con 400', (origen) => {
    expect(() => validar(uploadUrlRequestSchema, { ...base, captureSource: origen })).toThrow(BadRequestException);
  });

  it('sigue siendo estricto: un campo desconocido da 400', () => {
    expect(() => validar(uploadUrlRequestSchema, { ...base, capturedWith: 'system_scanner' })).toThrow(BadRequestException);
  });
});

describe('identityPackageSchema · evidence[].captureSource', () => {
  const vence = `${new Date().getUTCFullYear() + 5}-01-01`;
  const paquete = (evidencia: Record<string, unknown>) => ({
    identity: { documentType: 'ci', documentNumberHash: 'a'.repeat(64), documentLast4: '1234', expiresAt: vence },
    evidence: [
      { evidenceType: 'identity_front', storageKey: 't1/c1/k1', mimeType: 'image/jpeg', sha256Hash: 'b'.repeat(64), ...evidencia },
    ],
  });
  const evidenciaDe = (body: unknown) =>
    (validar(identityPackageSchema, body) as { evidence: Array<Record<string, unknown>> }).evidence[0]!;

  it('sin captureSource, la evidencia no lo lleva (el repositorio la guardará como NULL = cámara)', () => {
    expect(evidenciaDe(paquete({}))).not.toHaveProperty('captureSource');
  });

  it.each(CAPTURE_SOURCES)('acepta %s en cada evidencia', (origen) => {
    expect(evidenciaDe(paquete({ captureSource: origen })).captureSource).toBe(origen);
  });

  it.each(['gallery', 'scanner', '', 0])('rechaza %p con 400', (origen) => {
    expect(() => validar(identityPackageSchema, paquete({ captureSource: origen }))).toThrow(BadRequestException);
  });
  /*
   * Este esquema NO es `.strict()` (a diferencia de `uploadUrlRequestSchema`): una clave desconocida
   * se descarta en silencio, no da 400. Por eso un backend anterior a este cambio habría TIRADO el
   * origen sin avisar en vez de rechazar el paquete. Se deja fijado para que nadie lo suponga.
   */
  /*
   * El escáner del sistema sólo fotografía documentos: la selfie siempre sale de la cámara. Un
   * `system_scanner` en la selfie es un error del cliente y guardaría una etiqueta falsa.
   */
  it('rechaza system_scanner en la selfie con 400, y acepta camera o nada', () => {
    const selfie = (origen?: string) => paquete({ evidenceType: 'selfie', ...(origen === undefined ? {} : { captureSource: origen }) });
    expect(() => validar(identityPackageSchema, selfie('system_scanner'))).toThrow(BadRequestException);
    expect(evidenciaDe(selfie('camera')).captureSource).toBe('camera');
    expect(evidenciaDe(selfie())).not.toHaveProperty('captureSource');
  });

  it.each(['identity_front', 'identity_back'])('acepta system_scanner en %s', (evidenceType) => {
    expect(evidenciaDe(paquete({ evidenceType, captureSource: 'system_scanner' })).captureSource).toBe('system_scanner');
  });

  it('una clave desconocida en la evidencia se descarta, no da 400 (el esquema no es estricto)', () => {
    expect(evidenciaDe(paquete({ capturedWith: 'system_scanner' }))).not.toHaveProperty('capturedWith');
  });
});

/**
 * La prueba de vida en TRES poses (2026-09-28): frente (`selfie`), perfil izquierdo (`selfie_left`)
 * y perfil derecho (`selfie_right`). Las dos nuevas siguen la regla de la selfie —sólo cámara— y
 * una app vieja que manda sólo `selfie` sigue valiendo.
 */
describe('selfie en tres poses', () => {
  const vence = `${new Date().getUTCFullYear() + 5}-01-01`;
  const item = (evidenceType: string, extra: Record<string, unknown> = {}) => ({
    evidenceType,
    storageKey: `t1/c1/${evidenceType}`,
    mimeType: 'image/jpeg',
    sha256Hash: 'b'.repeat(64),
    ...extra,
  });
  const paquete = (evidence: unknown[]) => ({
    identity: { documentType: 'ci', documentNumberHash: 'a'.repeat(64), documentLast4: '1234', expiresAt: vence },
    evidence,
  });

  it('el paquete acepta anverso, reverso y las tres poses juntas', () => {
    const tipos = ['identity_front', 'identity_back', 'selfie', 'selfie_left', 'selfie_right'];
    const salida = validar(identityPackageSchema, paquete(tipos.map((tipo) => item(tipo)))) as {
      evidence: Array<{ evidenceType: string }>;
    };
    expect(salida.evidence.map((e) => e.evidenceType)).toEqual(tipos);
  });

  it('una app vieja con sólo la selfie de frente sigue valiendo', () => {
    expect(() => validar(identityPackageSchema, paquete([item('identity_front'), item('identity_back'), item('selfie')]))).not.toThrow();
  });

  it.each(['selfie_left', 'selfie_right'])('rechaza system_scanner en %s y acepta camera', (tipo) => {
    expect(() => validar(identityPackageSchema, paquete([item(tipo, { captureSource: 'system_scanner' })]))).toThrow(BadRequestException);
    expect(() => validar(identityPackageSchema, paquete([item(tipo, { captureSource: 'camera' })]))).not.toThrow();
  });

  it.each(['selfie_left', 'selfie_right'])('la subida con URL firmada acepta %s', (documentType) => {
    const body = { documentType, contentType: 'image/jpeg', sizeBytes: 1_000, captureSource: 'camera' };
    expect(validar(uploadUrlRequestSchema, body)).toEqual(body);
  });

  it('un tipo de pose inventado sigue siendo 400', () => {
    expect(() => validar(identityPackageSchema, paquete([item('selfie_up')]))).toThrow(BadRequestException);
    expect(() => validar(uploadUrlRequestSchema, { documentType: 'selfie_up', contentType: 'image/jpeg', sizeBytes: 1 })).toThrow(
      BadRequestException,
    );
  });
});
