/**
 * @file Adaptador de infraestructura: traduce el puerto del dominio a una tecnología concreta.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system normaliza los archivos multipart que entrega multer y acota sus límites desde el entorno.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { FileAdapterConfigService } from '../file-adapter-config.service.js';
import type { FileIngestAdapter, IncomingFile } from '../file-storage.types.js';

/**
 * Forma del archivo que multer deja en `request.file` / `request.files`.
 *
 * Se declara aquí en vez de importar `Express.Multer.File` a propósito: `tsconfig.json` fija
 * `types: ["node"]`, así que el namespace global de Express no entra al programa, y depender de él
 * obligaría a sumar `@types/multer` solo para nombrar cinco campos. Un tipo estructural propio
 * además deja claro qué se consume realmente y permite probar el adaptador sin Express.
 */
export type MulterLikeFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
};

/** Límites que se pasan a `MulterModule`. Forma estructural, por el mismo motivo que `MulterLikeFile`. */
export type MulterIngestLimits = {
  fileSize: number;
  files: number;
  /** Campos de texto del formulario: sin tope, un multipart puede agotar memoria sin subir un byte. */
  fields: number;
  parts: number;
};

/**
 * Límites del parser, derivados del entorno.
 *
 * Función libre —y no solo método— porque `MulterModule.registerAsync` los necesita en su fábrica,
 * donde no hay una instancia del adaptador disponible.
 *
 * `fileSize` se aplica aquí ADEMÁS de en `FileService` a propósito: multer corta el flujo mientras
 * entra, antes de materializar el buffer completo en memoria; la comprobación del servicio es la
 * que protege al resto de vías de ingesta.
 */
export function buildMulterLimits(config: FileAdapterConfigService): MulterIngestLimits {
  const files = config.getMaxFiles();
  return {
    fileSize: config.getMaxBytes(),
    files,
    fields: 32,
    // Un `part` es cada archivo o campo del multipart; el tope evita un formulario con miles.
    parts: files + 32,
  };
}

function isMulterLikeFile(value: unknown): value is MulterLikeFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fieldname === 'string' &&
    typeof candidate.originalname === 'string' &&
    typeof candidate.mimetype === 'string' &&
    typeof candidate.size === 'number'
  );
}

/**
 * Vía de ingesta multipart.
 *
 * Su única responsabilidad es TRADUCIR: no valida contenido, no decide si el tipo está permitido y
 * no toca el disco. Todo eso vive en `FileService`, y por eso la verificación es idéntica venga el
 * archivo por multer o por un ticket firmado. Cambiar multer por otra vía es reimplementar esta
 * interfaz y nada más.
 */
@Injectable()
export class MulterIngestAdapter implements FileIngestAdapter {
  readonly name = 'multer' as const;

  constructor(private readonly config: FileAdapterConfigService) {}

  buildLimits(): MulterIngestLimits {
    return buildMulterLimits(this.config);
  }

  normalize(raw: unknown): IncomingFile {
    if (!isMulterLikeFile(raw)) {
      throw new BadRequestException('FILE_MULTIPART_FIELD_MISSING');
    }
    if (!Buffer.isBuffer(raw.buffer)) {
      // Sin buffer, multer está configurado contra disco: este adaptador entrega bytes en memoria
      // porque el servicio necesita verlos para hashear, comprobar firma mágica y escanear.
      throw new BadRequestException('FILE_MULTIPART_BUFFER_MISSING');
    }

    return {
      declaredFilename: raw.originalname,
      declaredMimeType: raw.mimetype.toLowerCase().trim(),
      // `size` lo reporta multer, pero el tamaño que vale es el del buffer: es el que se persiste.
      sizeBytes: raw.buffer.byteLength,
      content: raw.buffer,
    };
  }

  normalizeMany(raw: unknown): IncomingFile[] {
    const items = Array.isArray(raw) ? raw : [];
    if (items.length === 0) {
      throw new BadRequestException('FILE_MULTIPART_FIELD_MISSING');
    }
    if (items.length > this.config.getMaxFiles()) {
      throw new BadRequestException('FILE_TOO_MANY_FILES');
    }
    return items.map((item) => this.normalize(item));
  }
}
