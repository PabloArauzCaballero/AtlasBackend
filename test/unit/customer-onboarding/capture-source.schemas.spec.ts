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
  it('una clave desconocida en la evidencia se descarta, no da 400 (el esquema no es estricto)', () => {
    expect(evidenciaDe(paquete({ capturedWith: 'system_scanner' }))).not.toHaveProperty('capturedWith');
  });
});
