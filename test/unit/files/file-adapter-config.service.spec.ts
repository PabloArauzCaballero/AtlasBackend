import { afterEach, describe, expect, it } from '@jest/globals';
import { FileAdapterConfigService } from '../../../src/common/files/file-adapter-config.service.js';
import { env } from '../../../src/config/env.js';

/**
 * El único punto donde el subsistema de archivos toca `env`.
 *
 * Dos decisiones se prueban aquí porque ninguna de las dos falla al arrancar si se rompe. La
 * primera: la allowlist DESCARTA los tipos que ninguna firma mágica sabe verificar, en vez de
 * aceptarlos —un tipo admitido que nadie puede comprobar es exactamente el hueco por el que entra
 * contenido arbitrario—, y los devuelve aparte para que el descarte no pase inadvertido. La
 * segunda: las credenciales de MinIO caen a las de la evidencia documental, porque hay UN MinIO por
 * entorno y dos juegos de variables para el mismo servidor sólo dan la oportunidad de que se
 * desalineen. Y devuelven `null` en vez de lanzar: el registro lo convierte en un fallo de ARRANQUE,
 * que es donde debe descubrirse.
 */
type Clave = keyof typeof env;

const original = new Map<Clave, unknown>();

function poner(valores: Partial<Record<Clave, unknown>>): void {
  for (const [clave, valor] of Object.entries(valores) as Array<[Clave, unknown]>) {
    if (!original.has(clave)) original.set(clave, (env as Record<string, unknown>)[clave]);
    (env as Record<string, unknown>)[clave] = valor;
  }
}

describe('FileAdapterConfigService', () => {
  const service = new FileAdapterConfigService();

  afterEach(() => {
    for (const [clave, valor] of original) (env as Record<string, unknown>)[clave] = valor;
    original.clear();
  });

  describe('adaptadores y límites', () => {
    it('lee del entorno el adaptador de entrada, el de almacén y los tres topes', () => {
      poner({
        FILE_INGEST_ADAPTER: 'presigned',
        FILE_STORAGE_ADAPTER: 'minio',
        FILE_UPLOAD_MAX_BYTES: 1234,
        FILE_UPLOAD_MAX_FILES: 5,
        FILE_UPLOAD_URL_TTL_SECONDS: 900,
      });

      expect(service.getIngestAdapter()).toBe('presigned');
      expect(service.getStorageAdapter()).toBe('minio');
      expect(service.getMaxBytes()).toBe(1234);
      expect(service.getMaxFiles()).toBe(5);
      expect(service.getUploadUrlTtlSeconds()).toBe(900);
    });
  });

  describe('allowlist de tipos', () => {
    it('descarta lo que ninguna firma mágica verifica y lo devuelve aparte', () => {
      poner({ FILE_UPLOAD_ALLOWED_MIME_TYPES: 'image/png,application/x-inventado,application/pdf' });

      expect(service.getAllowedMimeTypes()).toEqual(['image/png', 'application/pdf']);
      expect(service.getUnverifiableMimeTypes()).toEqual(['application/x-inventado']);
    });

    it('normaliza espacios y mayúsculas: `  IMAGE/PNG ` es el mismo tipo', () => {
      poner({ FILE_UPLOAD_ALLOWED_MIME_TYPES: '  IMAGE/PNG , application/pdf' });

      expect(service.getAllowedMimeTypes()).toEqual(['image/png', 'application/pdf']);
    });

    it('un tipo repetido no se duplica en la lista efectiva', () => {
      poner({ FILE_UPLOAD_ALLOWED_MIME_TYPES: 'image/png,image/png,IMAGE/PNG' });

      expect(service.getAllowedMimeTypes()).toEqual(['image/png']);
    });

    it('las comas de más no producen tipos vacíos', () => {
      poner({ FILE_UPLOAD_ALLOWED_MIME_TYPES: ',image/png,,' });

      expect(service.getAllowedMimeTypes()).toEqual(['image/png']);
      expect(service.getUnverifiableMimeTypes()).toEqual([]);
    });

    it('una lista entera de tipos inverificables deja la allowlist vacía —el arranque falla, no la subida', () => {
      poner({ FILE_UPLOAD_ALLOWED_MIME_TYPES: 'application/x-a,application/x-b' });

      expect(service.getAllowedMimeTypes()).toEqual([]);
      expect(service.getUnverifiableMimeTypes()).toEqual(['application/x-a', 'application/x-b']);
    });
  });

  describe('credenciales de MinIO', () => {
    it('caen a las de la evidencia documental: hay un solo MinIO por entorno', () => {
      poner({
        FILE_STORAGE_MINIO_ENDPOINT: undefined,
        FILE_STORAGE_MINIO_BUCKET: undefined,
        FILE_STORAGE_MINIO_ACCESS_KEY_ID: undefined,
        FILE_STORAGE_MINIO_SECRET_ACCESS_KEY: undefined,
        FILE_STORAGE_MINIO_REGION: undefined,
        FILE_STORAGE_MINIO_FORCE_PATH_STYLE: undefined,
        STORAGE_S3_ENDPOINT: 'http://minio:9000',
        STORAGE_S3_BUCKET: 'atlas',
        STORAGE_S3_ACCESS_KEY_ID: 'ak',
        STORAGE_S3_SECRET_ACCESS_KEY: 'sk',
        STORAGE_S3_REGION: 'us-east-1',
        STORAGE_S3_FORCE_PATH_STYLE: true,
      });

      expect(service.getMinioCredentials()).toEqual({
        endpoint: 'http://minio:9000',
        bucket: 'atlas',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        region: 'us-east-1',
        forcePathStyle: true,
      });
    });

    it('cuando se declaran las propias, mandan: separarlos a propósito sigue siendo posible', () => {
      poner({
        FILE_STORAGE_MINIO_ENDPOINT: 'http://otro:9000',
        FILE_STORAGE_MINIO_BUCKET: 'archivos',
        FILE_STORAGE_MINIO_ACCESS_KEY_ID: 'ak2',
        FILE_STORAGE_MINIO_SECRET_ACCESS_KEY: 'sk2',
        STORAGE_S3_ENDPOINT: 'http://minio:9000',
        STORAGE_S3_BUCKET: 'atlas',
        STORAGE_S3_ACCESS_KEY_ID: 'ak',
        STORAGE_S3_SECRET_ACCESS_KEY: 'sk',
      });

      expect(service.getMinioCredentials()).toEqual(
        expect.objectContaining({ endpoint: 'http://otro:9000', bucket: 'archivos', accessKeyId: 'ak2' }),
      );
    });

    it('si falta cualquiera de las cuatro esenciales devuelve null en vez de lanzar', () => {
      for (const ausente of ['ENDPOINT', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'] as const) {
        poner({
          FILE_STORAGE_MINIO_ENDPOINT: ausente === 'ENDPOINT' ? undefined : 'http://minio:9000',
          FILE_STORAGE_MINIO_BUCKET: ausente === 'BUCKET' ? undefined : 'atlas',
          FILE_STORAGE_MINIO_ACCESS_KEY_ID: ausente === 'ACCESS_KEY_ID' ? undefined : 'ak',
          FILE_STORAGE_MINIO_SECRET_ACCESS_KEY: ausente === 'SECRET_ACCESS_KEY' ? undefined : 'sk',
          STORAGE_S3_ENDPOINT: ausente === 'ENDPOINT' ? undefined : 'http://minio:9000',
          STORAGE_S3_BUCKET: ausente === 'BUCKET' ? undefined : 'atlas',
          STORAGE_S3_ACCESS_KEY_ID: ausente === 'ACCESS_KEY_ID' ? undefined : 'ak',
          STORAGE_S3_SECRET_ACCESS_KEY: ausente === 'SECRET_ACCESS_KEY' ? undefined : 'sk',
        });

        expect(service.getMinioCredentials()).toBeNull();
      }
    });

    it('el extremo público vacío significa «es el mismo», y se declara como nulo', () => {
      poner({ FILE_STORAGE_MINIO_PUBLIC_ENDPOINT: undefined, STORAGE_S3_PUBLIC_ENDPOINT: undefined });
      expect(service.getMinioPublicEndpoint()).toBeNull();

      poner({ STORAGE_S3_PUBLIC_ENDPOINT: 'https://archivos.example' });
      expect(service.getMinioPublicEndpoint()).toBe('https://archivos.example');

      poner({ FILE_STORAGE_MINIO_PUBLIC_ENDPOINT: 'https://propio.example' });
      expect(service.getMinioPublicEndpoint()).toBe('https://propio.example');
    });

    it('el prefijo de claves llega sin barras a los lados: si no, la clave saldría con `//`', () => {
      poner({ FILE_STORAGE_MINIO_KEY_PREFIX: '  //archivos/expedientes//  ' });
      expect(service.getMinioKeyPrefix()).toBe('archivos/expedientes');

      poner({ FILE_STORAGE_MINIO_KEY_PREFIX: '   ' });
      expect(service.getMinioKeyPrefix()).toBe('');
    });
  });

  describe('almacén local', () => {
    it('la raíz sale del entorno tal cual', () => {
      poner({ FILE_STORAGE_LOCAL_ROOT: '/var/atlas/archivos' });
      expect(service.getLocalRoot()).toBe('/var/atlas/archivos');
    });

    it('sin secreto no hay firma: null, para que el adaptador siga escribiendo por la vía directa', () => {
      poner({ FILE_STORAGE_LOCAL_URL_SECRET: undefined });
      expect(service.getLocalSignatureCredentials()).toBeNull();

      poner({ FILE_STORAGE_LOCAL_URL_SECRET: '   ' });
      expect(service.getLocalSignatureCredentials()).toBeNull();
    });

    it('con secreto entrega la firma junto a la base de subida', () => {
      poner({ FILE_STORAGE_LOCAL_URL_SECRET: '  s3cr3t  ', FILE_STORAGE_LOCAL_BASE_URL: 'http://localhost:3000/files' });

      expect(service.getLocalSignatureCredentials()).toEqual({ secret: 's3cr3t', uploadBaseUrl: 'http://localhost:3000/files' });
    });
  });
});
