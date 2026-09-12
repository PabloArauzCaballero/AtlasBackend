import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { FileAdapterConfigService } from '../../../src/common/files/file-adapter-config.service.js';
import { LOCAL_SIGNATURE_QUERY } from '../../../src/common/files/local-signature.util.js';
import { LocalFileStorageAdapter } from '../../../src/common/files/storage/local-file-storage.adapter.js';
import type { FileScope, VerifiedFile } from '../../../src/common/files/file-storage.types.js';

/**
 * Almacén en disco local.
 *
 * Lo que se fija aquí es que "local" no significa "relajado": la ruta la impone el servidor a partir
 * del ámbito, una clave que apunte fuera de la raíz se rechaza, y el ticket de subida va firmado y
 * con vencimiento igual que el prefirmado de S3.
 */
const SECRET = 'una-clave-de-al-menos-32-caracteres-para-firmar';

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

describe('LocalFileStorageAdapter', () => {
  let root: string;
  let adapter: LocalFileStorageAdapter;

  function buildConfig(overrides: Partial<FileAdapterConfigService> = {}): FileAdapterConfigService {
    return {
      getLocalRoot: () => root,
      getUploadUrlTtlSeconds: () => 300,
      getLocalSignatureCredentials: () => ({ secret: SECRET, uploadBaseUrl: 'http://localhost:3005/api/v1/files' }),
      ...overrides,
    } as FileAdapterConfigService;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'atlas-files-'));
    adapter = new LocalFileStorageAdapter(buildConfig());
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('write', () => {
    it('impone la ruta tenant/owner/categoría y devuelve la referencia persistible', async () => {
      const file = verifiedFile();
      const stored = await adapter.write(SCOPE, file);

      expect(stored.storageKey).toMatch(/^1\/42\/identity_front\/[0-9a-f-]{36}\.png$/);
      expect(stored).toMatchObject({ adapter: 'local', sizeBytes: file.sizeBytes, contentType: 'image/png', sha256Hex: file.sha256Hex });
      expect(await readFile(adapter.resolvePath(stored.storageKey))).toEqual(file.content);
    });

    it('nunca reutiliza el nombre que envió el cliente: dos subidas iguales no se pisan', async () => {
      const first = await adapter.write(SCOPE, verifiedFile());
      const second = await adapter.write(SCOPE, verifiedFile());
      expect(first.storageKey).not.toBe(second.storageKey);
    });

    it('neutraliza los segmentos del ámbito: un tenant con "../" no escapa de la raíz', async () => {
      const stored = await adapter.write({ tenantId: '../../etc', ownerId: '42/..', category: 'a\\b' }, verifiedFile());

      expect(stored.storageKey).not.toContain('..');
      expect(adapter.resolvePath(stored.storageKey).startsWith(resolve(root) + sep)).toBe(true);
    });

    it('deja el archivo solo legible por el proceso y no un temporal a medias', async () => {
      const stored = await adapter.write(SCOPE, verifiedFile());
      const stats = await stat(adapter.resolvePath(stored.storageKey));

      // En Windows el bit de grupo/otros no aplica; la comprobación se limita a las plataformas POSIX.
      if (process.platform !== 'win32') {
        expect(stats.mode & 0o077).toBe(0);
      }
      expect(stats.isFile()).toBe(true);
    });
  });

  describe('read y remove', () => {
    it('devuelve el contenido con su tamaño y hash recalculados', async () => {
      const file = verifiedFile(Buffer.from('bytes verificables'));
      const stored = await adapter.write(SCOPE, file);

      const read = await adapter.read(stored.storageKey);
      expect(read).toEqual({ content: file.content, sizeBytes: file.sizeBytes, contentType: null, sha256Hex: file.sha256Hex });
    });

    it('devuelve null —y no lanza— cuando la clave no existe', async () => {
      expect(await adapter.read('1/42/identity_front/inexistente.png')).toBeNull();
      expect(await adapter.remove('1/42/identity_front/inexistente.png')).toBe(false);
    });

    it('borra lo que existe y lo deja ilegible', async () => {
      const stored = await adapter.write(SCOPE, verifiedFile());
      expect(await adapter.remove(stored.storageKey)).toBe(true);
      expect(await adapter.read(stored.storageKey)).toBeNull();
    });

    it('rechaza una clave que apunte fuera de la raíz en vez de leer el archivo', async () => {
      // Sin esta guardia, un endpoint de descarga que acepte la clave del cliente serviría
      // cualquier archivo del host.
      await expect(adapter.read('../../../etc/passwd')).rejects.toThrow('FILE_STORAGE_KEY_OUTSIDE_ROOT');
      await expect(adapter.remove('../../../etc/passwd')).rejects.toThrow('FILE_STORAGE_KEY_OUTSIDE_ROOT');
    });
  });

  describe('createUploadTicket', () => {
    it('emite un permiso firmado, con vencimiento y con el tipo y el tamaño atados', () => {
      const now = new Date('2026-08-10T12:00:00.000Z');
      const ticket = adapter.createUploadTicket({ scope: SCOPE, contentType: 'image/png', extension: 'png', sizeBytes: 2048, now });

      expect(ticket.method).toBe('PUT');
      expect(ticket.storageKey).toMatch(/^1\/42\/identity_front\/[0-9a-f-]{36}\.png$/);
      expect(ticket.requiredHeaders).toEqual({ 'content-type': 'image/png', 'content-length': '2048' });
      expect(ticket.expiresAt).toBe('2026-08-10T12:05:00.000Z');
      expect(new URL(ticket.uploadUrl).searchParams.get(LOCAL_SIGNATURE_QUERY.signature)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('se niega a emitir tickets sin secreto de firma, en vez de emitirlos sin firmar', () => {
      const sinSecreto = new LocalFileStorageAdapter(buildConfig({ getLocalSignatureCredentials: () => null }));

      expect(() => sinSecreto.createUploadTicket({ scope: SCOPE, contentType: 'image/png', extension: 'png', sizeBytes: 1 })).toThrow(
        'FILE_STORAGE_LOCAL_URL_SECRET_MISSING',
      );
    });
  });

  describe('isConfigured', () => {
    it('exige una raíz para darse por configurado', () => {
      expect(adapter.isConfigured()).toBe(true);
      expect(new LocalFileStorageAdapter(buildConfig({ getLocalRoot: () => '   ' })).isConfigured()).toBe(false);
    });
  });
});
