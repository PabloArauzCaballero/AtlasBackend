import { describe, expect, it } from '@jest/globals';
import type { FileAdapterConfigService } from '../../../src/common/files/file-adapter-config.service.js';
import { MulterIngestAdapter, buildMulterLimits, type MulterLikeFile } from '../../../src/common/files/ingest/multer-ingest.adapter.js';

/**
 * Vía de ingesta multipart.
 *
 * El adaptador solo TRADUCE. Lo que se fija aquí es justamente eso: que no valide contenido (de eso
 * responde `FileService`, para que la verificación sea idéntica venga por donde venga el archivo) y
 * que rechace las formas con las que no puede trabajar en vez de propagar un objeto a medias.
 */
function buildConfig(overrides: Partial<FileAdapterConfigService> = {}): FileAdapterConfigService {
  return {
    getMaxBytes: () => 15 * 1024 * 1024,
    getMaxFiles: () => 3,
    ...overrides,
  } as FileAdapterConfigService;
}

function multerFile(overrides: Partial<MulterLikeFile> = {}): MulterLikeFile {
  return {
    fieldname: 'file',
    originalname: 'INE frente.PNG',
    mimetype: 'image/PNG',
    size: 9,
    buffer: Buffer.from('los bytes'),
    ...overrides,
  };
}

describe('MulterIngestAdapter', () => {
  const adapter = new MulterIngestAdapter(buildConfig());

  describe('normalize', () => {
    it('traduce el archivo de multer y normaliza el tipo declarado', () => {
      const incoming = adapter.normalize(multerFile());

      expect(incoming).toEqual({
        declaredFilename: 'INE frente.PNG',
        declaredMimeType: 'image/png',
        sizeBytes: 9,
        content: Buffer.from('los bytes'),
      });
    });

    it('usa el tamaño real del buffer y no el que reporta multer', () => {
      // Si ambos discreparan, el que se persiste es el buffer: creerle al otro dejaría un tamaño
      // registrado que no corresponde a lo almacenado.
      const incoming = adapter.normalize(multerFile({ size: 999 }));
      expect(incoming.sizeBytes).toBe(9);
    });

    it('no juzga el contenido: un tipo no permitido llega intacto para que lo rechace el servicio', () => {
      const incoming = adapter.normalize(multerFile({ mimetype: 'application/x-msdownload' }));
      expect(incoming.declaredMimeType).toBe('application/x-msdownload');
    });

    it('rechaza lo que no tiene la forma de un archivo de multer', () => {
      for (const raw of [undefined, null, {}, 'archivo', [], { fieldname: 'file' }]) {
        expect(() => adapter.normalize(raw)).toThrow('FILE_MULTIPART_FIELD_MISSING');
      }
    });

    it('rechaza un archivo sin buffer: multer estaría escribiendo a disco sin verificación previa', () => {
      expect(() => adapter.normalize(multerFile({ buffer: undefined }))).toThrow('FILE_MULTIPART_BUFFER_MISSING');
    });
  });

  describe('normalizeMany', () => {
    it('traduce cada archivo del lote', () => {
      const incoming = adapter.normalizeMany([multerFile(), multerFile({ originalname: 'reverso.png' })]);
      expect(incoming.map((file) => file.declaredFilename)).toEqual(['INE frente.PNG', 'reverso.png']);
    });

    it('rechaza un lote vacío o que no es un arreglo', () => {
      expect(() => adapter.normalizeMany([])).toThrow('FILE_MULTIPART_FIELD_MISSING');
      expect(() => adapter.normalizeMany(undefined)).toThrow('FILE_MULTIPART_FIELD_MISSING');
    });

    it('rechaza un lote que excede el máximo configurado', () => {
      expect(() => adapter.normalizeMany([multerFile(), multerFile(), multerFile(), multerFile()])).toThrow('FILE_TOO_MANY_FILES');
    });
  });

  describe('buildMulterLimits', () => {
    it('deriva los límites del entorno y acota también campos y partes', () => {
      // `fileSize` corta el flujo mientras entra; sin tope de `parts`, un formulario con miles de
      // campos agota memoria sin llegar a subir un archivo.
      expect(buildMulterLimits(buildConfig())).toEqual({ fileSize: 15 * 1024 * 1024, files: 3, fields: 32, parts: 35 });
      expect(adapter.buildLimits()).toEqual(buildMulterLimits(buildConfig()));
    });
  });
});
