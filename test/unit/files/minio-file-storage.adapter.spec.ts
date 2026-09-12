import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FileAdapterConfigService } from '../../../src/common/files/file-adapter-config.service.js';
import type { FileScope, VerifiedFile } from '../../../src/common/files/file-storage.types.js';
import { MinioFileStorageAdapter } from '../../../src/common/files/storage/minio-file-storage.adapter.js';
import type { S3Credentials } from '../../../src/common/storage/s3-signature.util.js';

/**
 * Almacén MinIO — el que corre POR DEFECTO.
 *
 * Lo que se fija aquí es lo que distingue a este adaptador de escribir en disco: la clave la impone
 * el servidor bajo el prefijo del tenant, el ticket que se entrega al teléfono se firma contra el
 * extremo PÚBLICO y no contra el interno, y un rechazo del almacén se convierte en 503 en vez de
 * darse por bueno. Esto último es lo que hacía que un despliegue mal configurado —credenciales que
 * MinIO no conoce— aceptara subidas que nadie podría recuperar.
 *
 * `fetch` se sustituye porque lo que interesa comprobar es QUÉ se le pide al almacén; que MinIO
 * responde a una URL bien firmada se verifica contra el MinIO real en el VPS, no aquí.
 */
const CREDENTIALS: S3Credentials = {
  endpoint: 'http://minio:9000',
  bucket: 'atlas-evidence',
  accessKeyId: 'llave-de-prueba',
  secretAccessKey: 'secreto-de-prueba',
  region: 'us-east-1',
  forcePathStyle: true,
};

const SCOPE: FileScope = { tenantId: '1', ownerId: '42', category: 'identity_front' };

function verifiedFile(content = Buffer.from('contenido de prueba')): VerifiedFile {
  return {
    content,
    contentType: 'image/png',
    sizeBytes: content.byteLength,
    sha256Hex: createHash('sha256').update(content).digest('hex'),
    extension: 'png',
  };
}

describe('MinioFileStorageAdapter', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  function buildConfig(overrides: Partial<Record<keyof FileAdapterConfigService, unknown>> = {}): FileAdapterConfigService {
    return {
      getMinioCredentials: () => CREDENTIALS,
      getMinioPublicEndpoint: () => 'https://archivos.atlas.example',
      getMinioKeyPrefix: () => 'files',
      getUploadUrlTtlSeconds: () => 300,
      ...overrides,
    } as unknown as FileAdapterConfigService;
  }

  function adapterWith(overrides: Partial<Record<keyof FileAdapterConfigService, unknown>> = {}): MinioFileStorageAdapter {
    return new MinioFileStorageAdapter(buildConfig(overrides));
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('isConfigured', () => {
    it('exige credenciales: sin ellas el registro debe impedir el arranque', () => {
      expect(adapterWith().isConfigured()).toBe(true);
      expect(adapterWith({ getMinioCredentials: () => null }).isConfigured()).toBe(false);
    });
  });

  describe('write', () => {
    it('impone la clave bajo el prefijo del servicio, del tenant y del dueño', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 } as never);

      const ref = await adapterWith().write(SCOPE, verifiedFile());

      expect(ref.adapter).toBe('minio');
      expect(ref.storageKey).toMatch(/^files\/1\/42\/identity_front\/[0-9a-f-]{36}\.png$/);
    });

    it('firma la escritura contra el extremo INTERNO, no contra el público', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 } as never);

      await adapterWith().write(SCOPE, verifiedFile());

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      // El proceso alcanza MinIO por la red de Docker; usar el dominio público aquí obligaría a que
      // el backend saliera a Internet para hablar con un contenedor vecino.
      expect(url.startsWith('http://minio:9000/atlas-evidence/files/')).toBe(true);
      expect(init.method).toBe('PUT');
      expect(url).toContain('X-Amz-Signature=');
    });

    it('traduce un rechazo del almacén en 503 en vez de dar la subida por buena', async () => {
      // Es el caso REAL que se encontró en el VPS: la llave del backend no existía en MinIO. Sin
      // esta comprobación, el dominio guardaba una `storageKey` de un objeto que nunca se escribió.
      fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'InvalidAccessKeyId' } as never);

      await expect(adapterWith().write(SCOPE, verifiedFile())).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('read', () => {
    it('devuelve el contenido con su hash recalculado sobre los bytes servidos', async () => {
      const content = Buffer.from('carnet');
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
      } as never);

      const stored = await adapterWith().read('files/1/42/identity_front/a.png');

      expect(stored?.contentType).toBe('image/png');
      expect(stored?.sizeBytes).toBe(content.byteLength);
      expect(stored?.sha256Hex).toBe(createHash('sha256').update(content).digest('hex'));
    });

    it('distingue "no está" de "no se pudo leer": 404 es null, cualquier otro fallo es 503', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 } as never);
      await expect(adapterWith().read('files/1/42/identity_front/a.png')).resolves.toBeNull();

      fetchMock.mockResolvedValue({ ok: false, status: 500 } as never);
      await expect(adapterWith().read('files/1/42/identity_front/a.png')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('remove', () => {
    it('borra con DELETE firmado y no falla si el objeto ya no estaba', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 204 } as never);
      await expect(adapterWith().remove('files/1/42/identity_front/a.png')).resolves.toBe(true);
      expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');

      fetchMock.mockResolvedValue({ ok: false, status: 404 } as never);
      await expect(adapterWith().remove('files/1/42/identity_front/a.png')).resolves.toBe(false);
    });
  });

  describe('createUploadTicket', () => {
    it('firma el ticket contra el extremo PÚBLICO: es el teléfono quien lo abre', () => {
      const ticket = adapterWith().createUploadTicket({
        scope: SCOPE,
        contentType: 'image/jpeg',
        extension: 'jpg',
        sizeBytes: 1024,
        now: new Date('2026-09-03T12:00:00.000Z'),
      });

      // Ésta es la trampa que dejó el VPS sirviendo URLs correctas e inalcanzables: firmadas contra
      // un extremo que sólo existe dentro de la red de Docker.
      expect(ticket.uploadUrl.startsWith('https://archivos.atlas.example/atlas-evidence/files/')).toBe(true);
      expect(ticket.method).toBe('PUT');
    });

    it('obliga tipo y tamaño en la firma, para acotar la subida ANTES de que el objeto exista', () => {
      const ticket = adapterWith().createUploadTicket({
        scope: SCOPE,
        contentType: 'image/jpeg',
        extension: 'jpg',
        sizeBytes: 1024,
        now: new Date('2026-09-03T12:00:00.000Z'),
      });

      expect(ticket.requiredHeaders).toEqual({ 'content-type': 'image/jpeg', 'content-length': '1024' });
      expect(ticket.uploadUrl).toContain('content-length%3Bcontent-type%3Bhost');
      expect(ticket.expiresAt).toBe('2026-09-03T12:05:00.000Z');
    });

    it('cae al extremo interno cuando no hay uno público declarado', () => {
      const ticket = adapterWith({ getMinioPublicEndpoint: () => null }).createUploadTicket({
        scope: SCOPE,
        contentType: 'image/jpeg',
        extension: 'jpg',
        sizeBytes: 1024,
        now: new Date('2026-09-03T12:00:00.000Z'),
      });

      expect(ticket.uploadUrl.startsWith('http://minio:9000/atlas-evidence/files/')).toBe(true);
    });
  });

  describe('createDownloadUrl', () => {
    it('emite una URL de lectura firmada, con vencimiento y contra el extremo público', () => {
      const { url, expiresAt } = adapterWith().createDownloadUrl('files/1/42/identity_front/a.png', new Date('2026-09-03T12:00:00.000Z'));

      expect(url.startsWith('https://archivos.atlas.example/atlas-evidence/files/1/42/identity_front/a.png?')).toBe(true);
      expect(url).toContain('X-Amz-Expires=300');
      expect(expiresAt).toBe('2026-09-03T12:05:00.000Z');
    });
  });
});
