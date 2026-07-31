/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza preserva evidencia operativa suficiente para diagnosticar incidentes con retención limitada.
 * @system sincroniza logs redactados hacia MongoDB, aplica TTL y ofrece consultas administrativas.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

/**
 * Lectura incremental del archivo de log y utilidades de diagnóstico de la sincronización.
 *
 * Están fuera de `log-sync.service.ts` porque son funciones puras de sistema de archivos y de
 * formateo de errores: no dependen del ciclo de vida de Nest, del cliente de Mongo ni del estado
 * del servicio, y se prueban directamente sin levantar nada.
 */
export type LogDelta = {
  exists: boolean;
  rotated: boolean;
  previousOffset: number;
  offsetFrom: number;
  offsetTo: number;
  content: string;
  fileSize: number;
};

export async function readLogDelta(filePath: string, lastOffset: number, maxChunkBytes: number): Promise<LogDelta> {
  const safeLastOffset = Math.max(0, lastOffset);
  const fileSize = await getFileSize(filePath);

  if (fileSize < 0) {
    return {
      exists: false,
      rotated: false,
      previousOffset: safeLastOffset,
      offsetFrom: safeLastOffset,
      offsetTo: safeLastOffset,
      content: '',
      fileSize: 0,
    };
  }

  const rotated = fileSize < safeLastOffset;
  const offsetFrom = rotated ? 0 : safeLastOffset;
  const offsetTo = Math.min(fileSize, offsetFrom + maxChunkBytes);

  if (offsetTo <= offsetFrom) {
    return {
      exists: true,
      rotated,
      previousOffset: safeLastOffset,
      offsetFrom,
      offsetTo,
      content: '',
      fileSize,
    };
  }

  const chunks: Buffer[] = [];
  const stream = createReadStream(filePath, { start: offsetFrom, end: offsetTo - 1 });

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return {
    exists: true,
    rotated,
    previousOffset: safeLastOffset,
    offsetFrom,
    offsetTo,
    content: Buffer.concat(chunks).toString('utf8'),
    fileSize,
  };
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

export async function getFileSize(filePath: string): Promise<number> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return -1;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function mongoSyncHint(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('tls') || normalized.includes('ssl') || normalized.includes('alert internal error')) {
    return (
      'fallo TLS al conectar con MongoDB. Revisa MONGO_DB_URL_CONNECTION, host SRV, usuario/password, TLS del cluster ' +
      'y allowlist de IP en MongoDB Atlas. Detalle: ' +
      message
    );
  }
  if (normalized.includes('authentication failed') || normalized.includes('auth')) {
    return `credenciales MongoDB rechazadas. Revisa usuario, password y authSource. Detalle: ${message}`;
  }
  if (normalized.includes('server selection') || normalized.includes('enotfound') || normalized.includes('econnrefused')) {
    return `MongoDB no esta alcanzable desde este backend. Revisa red, DNS, cluster host y allowlist. Detalle: ${message}`;
  }
  return message;
}
