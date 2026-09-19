import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { DocumentStorageService } from '../../../src/common/storage/document-storage.service.js';
import { env } from '../../../src/config/env.js';

/**
 * El almacén de evidencia: dónde se guarda lo que el cliente sube y qué se comprueba antes de
 * creerlo.
 *
 * Todo lo que se fija aquí es de seguridad, y ninguna de las comprobaciones lanza un error si se
 * cae: quien sube el archivo es la parte interesada en que parezca lo que no es. La clave del
 * objeto nunca la propone quien sube —es lo que impide escribir fuera de su propio espacio—, el
 * hash y el tipo se verifican sobre los BYTES reales, y un antivirus que se cae en silencio no
 * puede degradar a «aceptar».
 */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const originales: Record<string, unknown> = {};
const CLAVES = [
  'STORAGE_S3_ENDPOINT',
  'STORAGE_S3_PUBLIC_ENDPOINT',
  'STORAGE_S3_BUCKET',
  'STORAGE_S3_ACCESS_KEY_ID',
  'STORAGE_S3_SECRET_ACCESS_KEY',
];

function configurar(over: Record<string, unknown> = {}) {
  const mutable = env as unknown as Record<string, unknown>;
  mutable.STORAGE_S3_ENDPOINT = 'https://minio.interno:9000';
  mutable.STORAGE_S3_PUBLIC_ENDPOINT = undefined;
  mutable.STORAGE_S3_BUCKET = 'atlas-evidencias';
  mutable.STORAGE_S3_ACCESS_KEY_ID = 'llave';
  mutable.STORAGE_S3_SECRET_ACCESS_KEY = 'secreto';
  Object.assign(mutable, over);
}

function escaner(over: Partial<{ status: string; signature: string; failsClosed: boolean }> = {}) {
  return {
    scan: jest.fn(async () => ({ status: over.status ?? 'clean', signature: over.signature ?? null })),
    failsClosed: jest.fn(() => over.failsClosed ?? true),
  };
}

function conFetch(cuerpo: Buffer | null, contentType = 'image/png', ok = true) {
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok,
    status: ok ? 200 : 404,
    arrayBuffer: async () => cuerpo ?? Buffer.alloc(0),
    headers: { get: () => contentType },
  }));
}

describe('DocumentStorageService', () => {
  let fetchOriginal: typeof globalThis.fetch;

  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    const mutable = env as unknown as Record<string, unknown>;
    for (const k of CLAVES) originales[k] = mutable[k];
    configurar();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    const mutable = env as unknown as Record<string, unknown>;
    for (const k of CLAVES) mutable[k] = originales[k];
  });

  describe('el permiso de subida', () => {
    /*
     * El prefijo `tenantId/subjectId/` es lo que impide que alguien escriba —o lea— fuera de su
     * propio espacio: la política del bucket se restringe a ese patrón, y la clave nunca la propone
     * quien sube.
     */
    it('construye la clave con el prefijo del tenant y del sujeto, y la extensión del tipo', () => {
      const servicio = new DocumentStorageService(escaner() as never);

      const ticket = servicio.createUploadTicket({
        tenantId: '1',
        subjectId: 'customer-24',
        documentType: 'identity_front',
        contentType: 'image/png',
        sizeBytes: 100,
      });

      expect(ticket.storageKey).toMatch(/^1\/customer-24\/identity_front\/[0-9a-f-]{36}\.png$/);
      expect(ticket.method).toBe('PUT');
    });

    it('la extensión sigue al tipo declarado, no al nombre del archivo', () => {
      const servicio = new DocumentStorageService(escaner() as never);
      const de = (contentType: string) =>
        servicio.createUploadTicket({ tenantId: '1', subjectId: 's', documentType: 'd', contentType: contentType as never, sizeBytes: 1 })
          .storageKey;

      expect(de('application/pdf')).toMatch(/\.pdf$/);
      expect(de('image/png')).toMatch(/\.png$/);
      expect(de('image/jpeg')).toMatch(/\.jpg$/);
    });

    /* El tamaño y el tipo van FIRMADOS: si el teléfono sube otra cosa, S3 rechaza la petición. */
    it('firma el tipo y el tamaño como cabeceras obligatorias', () => {
      const servicio = new DocumentStorageService(escaner() as never);

      const ticket = servicio.createUploadTicket({
        tenantId: '1',
        subjectId: 's',
        documentType: 'd',
        contentType: 'image/png',
        sizeBytes: 4096,
      });

      expect(ticket.requiredHeaders).toEqual({ 'content-type': 'image/png', 'content-length': '4096' });
      expect(ticket.uploadUrl).toContain('X-Amz-SignedHeaders');
    });

    /*
     * La URL que se le entrega al teléfono lleva el extremo PÚBLICO; la firma es la misma porque se
     * calcula sobre el mismo bucket y la misma clave. Sin esto, el teléfono recibiría una dirección
     * interna que no resuelve desde fuera.
     */
    it('usa el extremo público para la URL que recibe el teléfono', () => {
      configurar({ STORAGE_S3_PUBLIC_ENDPOINT: 'https://archivos.atlas.bo' });
      const servicio = new DocumentStorageService(escaner() as never);

      const ticket = servicio.createUploadTicket({
        tenantId: '1',
        subjectId: 's',
        documentType: 'd',
        contentType: 'image/png',
        sizeBytes: 1,
      });

      expect(ticket.uploadUrl).toContain('archivos.atlas.bo');
      expect(ticket.uploadUrl).not.toContain('minio.interno');
    });

    it('sin almacén configurado no emite permiso: falla en vez de firmar contra nada', () => {
      configurar({ STORAGE_S3_BUCKET: undefined });
      const servicio = new DocumentStorageService(escaner() as never);

      expect(servicio.isConfigured()).toBe(false);
      expect(() =>
        servicio.createUploadTicket({ tenantId: '1', subjectId: 's', documentType: 'd', contentType: 'image/png', sizeBytes: 1 }),
      ).toThrow('DOCUMENT_STORAGE_NOT_CONFIGURED');
    });
  });

  describe('verificar lo que de verdad se subió', () => {
    const verificar = (servicio: DocumentStorageService, over: Record<string, unknown> = {}) =>
      servicio.verifyDeclaredObject({
        storageKey: '1/customer-24/identity_front/x.png',
        declaredSha256: sha(PNG),
        declaredMimeType: 'image/png',
        declaredSizeBytes: PNG.byteLength,
        ...over,
      } as never);

    it('acepta el objeto cuyo hash, tamaño y firma coinciden con lo declarado', async () => {
      conFetch(PNG);
      const servicio = new DocumentStorageService(escaner() as never);

      const resultado = await verificar(servicio);

      expect(resultado.ok).toBe(true);
      expect(resultado.ok && resultado.metadata.sha256Hex).toBe(sha(PNG));
    });

    /* El hash es lo que ata la imagen que se ve a la que el motor evaluó. */
    it('rechaza si el hash no es el declarado', async () => {
      conFetch(PNG);
      const servicio = new DocumentStorageService(escaner() as never);

      const resultado = await verificar(servicio, { declaredSha256: 'a'.repeat(64) });

      expect(resultado).toEqual({ ok: false, reason: 'EVIDENCE_HASH_MISMATCH' });
    });

    /*
     * La firma del contenido se comprueba sobre los BYTES: declarar `image/png` y subir otra cosa
     * es el camino por el que entra un archivo que el visor interpreta de otra forma.
     */
    it('rechaza si los bytes no son del tipo declarado', async () => {
      const noEsPng = Buffer.from('%PDF-1.7 esto es un pdf');
      conFetch(noEsPng);
      const servicio = new DocumentStorageService(escaner() as never);

      const resultado = await verificar(servicio, {
        declaredSha256: sha(noEsPng),
        declaredSizeBytes: noEsPng.byteLength,
      });

      expect(resultado).toEqual({ ok: false, reason: 'EVIDENCE_CONTENT_TYPE_MISMATCH' });
    });

    it('rechaza el objeto vacío y el que no está', async () => {
      const servicio = new DocumentStorageService(escaner() as never);

      conFetch(Buffer.alloc(0));
      expect(await verificar(servicio, { declaredSha256: sha(Buffer.alloc(0)), declaredSizeBytes: 0 })).toEqual({
        ok: false,
        reason: 'EVIDENCE_OBJECT_EMPTY',
      });

      conFetch(null, 'image/png', false);
      expect(await verificar(servicio)).toEqual({ ok: false, reason: 'EVIDENCE_OBJECT_NOT_FOUND' });
    });

    it('rechaza si el tamaño declarado no es el real', async () => {
      conFetch(PNG);
      const servicio = new DocumentStorageService(escaner() as never);

      expect(await verificar(servicio, { declaredSizeBytes: 999 })).toEqual({ ok: false, reason: 'EVIDENCE_SIZE_MISMATCH' });
    });

    it('rechaza lo infectado', async () => {
      conFetch(PNG);
      const servicio = new DocumentStorageService(escaner({ status: 'infected', signature: 'EICAR' }) as never);

      expect(await verificar(servicio)).toEqual({ ok: false, reason: 'EVIDENCE_MALWARE_DETECTED' });
    });

    /*
     * Con el escáner configurado, un fallo de conexión NO puede degradar a «aceptar»: un antivirus
     * que se cae en silencio es peor que no tenerlo, porque genera confianza infundada.
     */
    it('con el escáner caído y política de fallo cerrado, rechaza', async () => {
      conFetch(PNG);
      const servicio = new DocumentStorageService(escaner({ status: 'error', failsClosed: true }) as never);

      expect(await verificar(servicio)).toEqual({ ok: false, reason: 'EVIDENCE_SCAN_UNAVAILABLE' });
    });

    it('sin escáner exigido, su fallo no bloquea la evidencia', async () => {
      conFetch(PNG);
      const servicio = new DocumentStorageService(escaner({ status: 'error', failsClosed: false }) as never);

      expect((await verificar(servicio)).ok).toBe(true);
    });

    /*
     * El antimalware va AL FINAL a propósito: es la comprobación más cara y no tiene sentido pagarla
     * por un objeto que ya falló el hash.
     */
    it('no paga el antimalware por un objeto que ya falló el hash', async () => {
      conFetch(PNG);
      const scanner = escaner();
      const servicio = new DocumentStorageService(scanner as never);

      await verificar(servicio, { declaredSha256: 'b'.repeat(64) });

      expect(scanner.scan).not.toHaveBeenCalled();
    });
  });
});
