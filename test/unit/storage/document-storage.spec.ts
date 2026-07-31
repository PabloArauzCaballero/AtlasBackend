import { describe, expect, it, jest } from '@jest/globals';
import { presignS3Url } from '../../../src/common/storage/s3-signature.util.js';
import { matchesMagicBytes } from '../../../src/common/storage/document-storage.service.js';

/**
 * Firma SigV4 y validación de contenido.
 *
 * La firma se implementó con `node:crypto` en vez de incorporar el SDK de AWS: el repositorio exige
 * un ADR para agregar una librería, y de todo el SDK solo hacía falta firmar dos verbos. Estos tests
 * fijan las propiedades que hacen útil esa firma —determinismo y sensibilidad a cada entrada— sin
 * atarse a un vector de prueba de AWS que envejecería mal.
 */
const CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  bucket: 'atlas-evidence',
  forcePathStyle: true,
};

const NOW = new Date('2026-07-28T12:00:00.000Z');

describe('presignS3Url', () => {
  function sign(overrides: Record<string, unknown> = {}) {
    return presignS3Url({
      credentials: CREDENTIALS,
      method: 'PUT',
      objectKey: '1/42/identity_front/abc.jpg',
      expiresInSeconds: 300,
      signedHeaders: { 'content-type': 'image/jpeg', 'content-length': '1024' },
      now: NOW,
      ...overrides,
    } as never);
  }

  it('produce una URL con todos los parámetros que exige SigV4', () => {
    const url = sign();
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Credential=');
    expect(url).toContain('X-Amz-Date=20260728T120000Z');
    expect(url).toContain('X-Amz-Expires=300');
    expect(url).toContain('X-Amz-Signature=');
    // Las cabeceras firmadas van declaradas: alterarlas al subir invalida la URL.
    expect(url).toContain('content-length%3Bcontent-type%3Bhost');
  });

  it('es determinista: la misma entrada produce siempre la misma firma', () => {
    expect(sign()).toBe(sign());
  });

  it('la firma cambia si cambia el objeto, el método, el vencimiento o cualquier cabecera firmada', () => {
    const base = sign();
    expect(sign({ objectKey: '1/42/identity_front/otro.jpg' })).not.toBe(base);
    expect(sign({ method: 'GET' })).not.toBe(base);
    expect(sign({ expiresInSeconds: 600 })).not.toBe(base);
    // Cambiar el tamaño declarado invalida la firma: es lo que acota el tamaño ANTES de subir.
    expect(sign({ signedHeaders: { 'content-type': 'image/jpeg', 'content-length': '2048' } })).not.toBe(base);
    expect(sign({ signedHeaders: { 'content-type': 'application/pdf', 'content-length': '1024' } })).not.toBe(base);
  });

  it('respeta el estilo de ruta: path-style para MinIO, virtual-host para AWS', () => {
    expect(sign()).toContain('/atlas-evidence/1/42/identity_front/abc.jpg');
    const virtualHost = presignS3Url({
      credentials: { ...CREDENTIALS, forcePathStyle: false },
      method: 'PUT',
      objectKey: 'k.jpg',
      expiresInSeconds: 300,
      now: NOW,
    });
    expect(virtualHost).toContain('https://atlas-evidence.s3.us-east-1.amazonaws.com/k.jpg');
  });

  it('codifica la clave del objeto sin escapar las barras de la ruta', () => {
    const url = sign({ objectKey: '1/42/proof of address/año.pdf' });
    expect(url).toContain('/1/42/proof%20of%20address/a%C3%B1o.pdf');
  });
});

describe('matchesMagicBytes', () => {
  /**
   * El `Content-Type` lo declara quien sube; los primeros bytes del archivo no mienten. Sin esta
   * comprobación, renombrar un ejecutable a `.jpg` bastaba para almacenarlo como evidencia de
   * identidad.
   */
  it('acepta cada tipo permitido cuando la firma del archivo coincide', () => {
    expect(matchesMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true);
    expect(matchesMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).toBe(true);
    expect(matchesMagicBytes(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), 'application/pdf')).toBe(true);
  });

  it('rechaza un archivo cuyo contenido no corresponde al tipo declarado', () => {
    // Un PE de Windows ("MZ") renombrado a .jpg.
    expect(matchesMagicBytes(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'image/jpeg')).toBe(false);
    // Un PNG declarado como PDF.
    expect(matchesMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'application/pdf')).toBe(false);
    expect(matchesMagicBytes(Buffer.from([]), 'image/png')).toBe(false);
  });
});

describe('DocumentStorageService', () => {
  async function buildService(env: Record<string, unknown>) {
    jest.resetModules();
    const configModule = await import('../../../src/config/env.js');
    Object.assign(configModule.env, env);
    const { DocumentStorageService } = await import('../../../src/common/storage/document-storage.service.js');
    return new DocumentStorageService();
  }

  const CONFIGURED = {
    STORAGE_S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
    STORAGE_S3_BUCKET: 'atlas-evidence',
    STORAGE_S3_REGION: 'us-east-1',
    STORAGE_S3_ACCESS_KEY_ID: 'AKIA',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
    STORAGE_S3_FORCE_PATH_STYLE: true,
    STORAGE_UPLOAD_URL_TTL_SECONDS: 300,
  };

  it('no se considera configurado si falta cualquier pieza de la conexión', async () => {
    const service = await buildService({ ...CONFIGURED, STORAGE_S3_BUCKET: undefined });
    expect(service.isConfigured()).toBe(false);
  });

  /**
   * El prefijo `tenant/cliente/` es lo que impide que un cliente escriba fuera de su propio espacio:
   * la política del bucket puede restringirse a ese patrón, y la clave nunca la propone quien sube.
   */
  it('impone la ruta del objeto bajo el prefijo del tenant y del cliente', async () => {
    const service = await buildService(CONFIGURED);
    const ticket = service.createUploadTicket({
      tenantId: '7',
      customerId: '42',
      documentType: 'identity_front',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      now: NOW,
    });
    expect(ticket.storageKey).toMatch(/^7\/42\/identity_front\/[0-9a-f-]{36}\.jpg$/);
    expect(ticket.method).toBe('PUT');
    expect(ticket.requiredHeaders).toEqual({ 'content-type': 'image/jpeg', 'content-length': '2048' });
    expect(ticket.expiresAt).toBe(new Date(NOW.getTime() + 300_000).toISOString());
  });

  it('deriva la extensión del tipo declarado, no de un nombre que el cliente proponga', async () => {
    const service = await buildService(CONFIGURED);
    const pdf = service.createUploadTicket({
      tenantId: '7',
      customerId: '42',
      documentType: 'proof_of_address',
      contentType: 'application/pdf',
      sizeBytes: 10,
      now: NOW,
    });
    expect(pdf.storageKey.endsWith('.pdf')).toBe(true);
  });

  it('sin almacenamiento configurado, emitir un permiso de subida falla en vez de devolver una URL rota', async () => {
    const service = await buildService({ ...CONFIGURED, STORAGE_S3_ACCESS_KEY_ID: undefined });
    expect(() =>
      service.createUploadTicket({
        tenantId: '7',
        customerId: '42',
        documentType: 'selfie',
        contentType: 'image/png',
        sizeBytes: 10,
        now: NOW,
      }),
    ).toThrow(/DOCUMENT_STORAGE_NOT_CONFIGURED/);
  });
});
