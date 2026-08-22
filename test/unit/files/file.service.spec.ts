import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import type { FileAdapterConfigService } from '../../../src/common/files/file-adapter-config.service.js';
import type { FileAdapterRegistry } from '../../../src/common/files/file-adapter.registry.js';
import { FileService } from '../../../src/common/files/file.service.js';
import type { MalwareScannerService, ScanVerdict } from '../../../src/common/storage/malware-scanner.service.js';
import type {
  FileScope,
  FileStorageAdapter,
  IncomingFile,
  StoredFileContent,
  StoredFileRef,
  VerifiedFile,
} from '../../../src/common/files/file-storage.types.js';

/**
 * Servicio central de archivos.
 *
 * Toda la verificación vive aquí y no en los adaptadores, así que estas pruebas son las que
 * garantizan que un archivo subido por multipart recibe el MISMO trato que uno subido con un ticket
 * firmado — y que añadir un almacén nuevo (Cloudinary, mañana) no puede abrir una vía sin verificar.
 */
const MAX_BYTES = 1024;
const SCOPE: FileScope = { tenantId: '1', ownerId: '42', category: 'identity_front' };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBuffer(size = 64): Buffer {
  const buffer = Buffer.alloc(size, 0x11);
  Buffer.from(PNG_MAGIC).copy(buffer);
  return buffer;
}

function incoming(overrides: Partial<IncomingFile> = {}): IncomingFile {
  const content = overrides.content ?? pngBuffer();
  return {
    declaredFilename: 'ine.png',
    declaredMimeType: 'image/png',
    sizeBytes: content.byteLength,
    content,
    ...overrides,
  };
}

describe('FileService', () => {
  let storage: jest.Mocked<FileStorageAdapter>;
  let scanVerdict: ScanVerdict;
  let failsClosed: boolean;
  let service: FileService;

  function buildService(configOverrides: Partial<FileAdapterConfigService> = {}): FileService {
    const config = {
      getMaxBytes: () => MAX_BYTES,
      getMaxFiles: () => 3,
      getAllowedMimeTypes: () => ['image/png', 'application/pdf'],
      getUploadUrlTtlSeconds: () => 300,
      ...configOverrides,
    } as FileAdapterConfigService;

    const registry = {
      resolveStorage: () => storage,
      resolveIngest: () => ({
        name: 'multer' as const,
        normalize: (raw: unknown) => raw as IncomingFile,
        normalizeMany: (raw: unknown) => raw as IncomingFile[],
      }),
    } as unknown as FileAdapterRegistry;

    const scanner = {
      scan: async () => scanVerdict,
      failsClosed: () => failsClosed,
      isEnabled: () => failsClosed,
    } as unknown as MalwareScannerService;

    return new FileService(registry, config, scanner);
  }

  beforeEach(() => {
    scanVerdict = { status: 'clean' };
    failsClosed = true;
    storage = {
      name: 'local',
      isConfigured: jest.fn(() => true),
      write: jest.fn(async (_scope: FileScope, file: VerifiedFile): Promise<StoredFileRef> => ({
        adapter: 'local',
        storageKey: '1/42/identity_front/generada.png',
        sizeBytes: file.sizeBytes,
        contentType: file.contentType,
        sha256Hex: file.sha256Hex,
        storedAt: '2026-08-10T12:00:00.000Z',
      })),
      read: jest.fn(async (): Promise<StoredFileContent | null> => null),
      remove: jest.fn(async () => true),
      createUploadTicket: jest.fn(() => ({
        storageKey: '1/42/identity_front/generada.png',
        uploadUrl: 'http://localhost/upload',
        method: 'PUT' as const,
        requiredHeaders: {},
        expiresAt: '2026-08-10T12:05:00.000Z',
      })),
    } as unknown as jest.Mocked<FileStorageAdapter>;
    service = buildService();
  });

  describe('store', () => {
    it('persiste el archivo válido y calcula su hash sobre los bytes reales', async () => {
      const file = incoming();
      const result = await service.store(SCOPE, file);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          adapter: 'local',
          contentType: 'image/png',
          sha256Hex: createHash('sha256').update(file.content).digest('hex'),
        }),
      });
      expect(storage.write).toHaveBeenCalledTimes(1);
    });

    it('rechaza un archivo vacío', async () => {
      const result = await service.store(SCOPE, incoming({ content: Buffer.alloc(0), sizeBytes: 0 }));
      expect(result).toEqual({ ok: false, reason: 'FILE_EMPTY' });
      expect(storage.write).not.toHaveBeenCalled();
    });

    it('rechaza un archivo por encima del máximo configurado', async () => {
      const result = await service.store(SCOPE, incoming({ content: pngBuffer(MAX_BYTES + 1) }));
      expect(result).toEqual({ ok: false, reason: 'FILE_TOO_LARGE' });
      expect(storage.write).not.toHaveBeenCalled();
    });

    it('rechaza un tipo fuera de la allowlist aunque el backend sepa verificarlo', async () => {
      // `image/jpeg` tiene firma mágica conocida, pero este despliegue no lo admite: la allowlist
      // manda, para que restringirla surta efecto de verdad.
      const jpeg = Buffer.alloc(32, 0x00);
      Buffer.from([0xff, 0xd8, 0xff]).copy(jpeg);
      const result = await service.store(SCOPE, incoming({ content: jpeg, declaredMimeType: 'image/jpeg' }));

      expect(result).toEqual({ ok: false, reason: 'FILE_CONTENT_TYPE_NOT_ALLOWED' });
    });

    it('rechaza un binario disfrazado: el tipo declarado no coincide con los primeros bytes', async () => {
      const elf = Buffer.alloc(64, 0x00);
      Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(elf);
      const result = await service.store(SCOPE, incoming({ content: elf, declaredMimeType: 'image/png' }));

      expect(result).toEqual({ ok: false, reason: 'FILE_CONTENT_TYPE_MISMATCH' });
      expect(storage.write).not.toHaveBeenCalled();
    });

    it('rechaza un archivo infectado', async () => {
      scanVerdict = { status: 'infected', signature: 'Eicar-Test-Signature' };
      expect(await service.store(SCOPE, incoming())).toEqual({ ok: false, reason: 'FILE_MALWARE_DETECTED' });
      expect(storage.write).not.toHaveBeenCalled();
    });

    it('con el escáner configurado, un fallo de conexión NO degrada a aceptar', async () => {
      scanVerdict = { status: 'error', reason: 'ECONNREFUSED' };
      expect(await service.store(SCOPE, incoming())).toEqual({ ok: false, reason: 'FILE_SCAN_UNAVAILABLE' });
    });

    it('con el escáner apagado, el archivo se acepta sin escanear (postura de desarrollo)', async () => {
      failsClosed = false;
      scanVerdict = { status: 'skipped', reason: 'scanner_disabled' };
      service = buildService();

      expect((await service.store(SCOPE, incoming())).ok).toBe(true);
    });

    it('no escanea lo que ya falló una comprobación más barata', async () => {
      const scanner = jest.fn<() => Promise<ScanVerdict>>(async () => ({ status: 'clean' }));
      const withSpy = new FileService(
        { resolveStorage: () => storage, resolveIngest: () => ({}) } as unknown as FileAdapterRegistry,
        { getMaxBytes: () => MAX_BYTES, getAllowedMimeTypes: () => ['image/png'] } as FileAdapterConfigService,
        { scan: scanner, failsClosed: () => true } as unknown as MalwareScannerService,
      );

      await withSpy.store(SCOPE, incoming({ content: pngBuffer(MAX_BYTES + 1) }));
      expect(scanner).not.toHaveBeenCalled();
    });
  });

  describe('storeOrThrow', () => {
    it('traduce cada rechazo a su excepción HTTP', async () => {
      await expect(service.storeOrThrow(SCOPE, incoming({ content: pngBuffer(MAX_BYTES + 1) }))).rejects.toMatchObject({ status: 413 });
      await expect(
        service.storeOrThrow(SCOPE, incoming({ content: Buffer.from([0xff, 0xd8, 0xff, 0x00]), declaredMimeType: 'image/jpeg' })),
      ).rejects.toMatchObject({ status: 415 });
      await expect(service.storeOrThrow(SCOPE, incoming({ content: Buffer.alloc(0), sizeBytes: 0 }))).rejects.toMatchObject({
        status: 400,
      });
    });

    it('devuelve la referencia cuando el archivo es válido', async () => {
      await expect(service.storeOrThrow(SCOPE, incoming())).resolves.toMatchObject({ adapter: 'local' });
    });
  });

  describe('createUploadTicket', () => {
    it('delega en el almacén activo cuando el tipo y el tamaño son admisibles', () => {
      const ticket = service.createUploadTicket({ scope: SCOPE, contentType: 'IMAGE/PNG', sizeBytes: 512 });

      expect(ticket.method).toBe('PUT');
      expect(storage.createUploadTicket).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png', extension: 'png' }));
    });

    it('no emite ticket para un tipo no admitido ni para un tamaño fuera de rango', () => {
      expect(() => service.createUploadTicket({ scope: SCOPE, contentType: 'image/jpeg', sizeBytes: 10 })).toThrow();
      expect(() => service.createUploadTicket({ scope: SCOPE, contentType: 'image/png', sizeBytes: MAX_BYTES + 1 })).toThrow();
      expect(() => service.createUploadTicket({ scope: SCOPE, contentType: 'image/png', sizeBytes: 0 })).toThrow();
      expect(storage.createUploadTicket).not.toHaveBeenCalled();
    });
  });

  describe('verifyStored', () => {
    const content = pngBuffer();
    const sha256Hex = createHash('sha256').update(content).digest('hex');

    function storedObject(): StoredFileContent {
      return { content, sizeBytes: content.byteLength, contentType: 'image/png', sha256Hex };
    }

    it('acepta el objeto cuyo hash, tamaño y bytes respaldan lo declarado', async () => {
      storage.read.mockResolvedValue(storedObject());

      const result = await service.verifyStored({
        storageKey: '1/42/identity_front/x.png',
        declaredSha256: sha256Hex.toUpperCase(),
        declaredMimeType: 'image/png',
        declaredSizeBytes: content.byteLength,
      });

      expect(result).toEqual({ ok: true, value: expect.objectContaining({ storageKey: '1/42/identity_front/x.png', sha256Hex }) });
    });

    it('rechaza un objeto ausente, un hash que no cuadra o un tamaño que no cuadra', async () => {
      storage.read.mockResolvedValue(null);
      await expect(
        service.verifyStored({ storageKey: 'x', declaredSha256: sha256Hex, declaredMimeType: 'image/png', declaredSizeBytes: null }),
      ).resolves.toEqual({ ok: false, reason: 'FILE_NOT_FOUND' });

      storage.read.mockResolvedValue(storedObject());
      await expect(
        service.verifyStored({ storageKey: 'x', declaredSha256: 'a'.repeat(64), declaredMimeType: 'image/png', declaredSizeBytes: null }),
      ).resolves.toEqual({ ok: false, reason: 'FILE_HASH_MISMATCH' });

      await expect(
        service.verifyStored({ storageKey: 'x', declaredSha256: sha256Hex, declaredMimeType: 'image/png', declaredSizeBytes: 1 }),
      ).resolves.toEqual({ ok: false, reason: 'FILE_SIZE_MISMATCH' });
    });

    it('vuelve a contrastar los bytes contra el tipo declarado, no solo el hash', async () => {
      // El hash prueba que el objeto es el que se anunció; no prueba que sea una imagen.
      storage.read.mockResolvedValue(storedObject());

      await expect(
        service.verifyStored({ storageKey: 'x', declaredSha256: sha256Hex, declaredMimeType: 'application/pdf', declaredSizeBytes: null }),
      ).resolves.toEqual({ ok: false, reason: 'FILE_CONTENT_TYPE_MISMATCH' });
    });
  });

  describe('delegación al almacén activo', () => {
    it('retrieve y remove no interponen lógica propia', async () => {
      await service.retrieve('clave');
      await service.remove('clave');

      expect(storage.read).toHaveBeenCalledWith('clave');
      expect(storage.remove).toHaveBeenCalledWith('clave');
    });
  });
});
