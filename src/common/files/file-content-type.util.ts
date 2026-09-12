/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system contrasta el tipo declarado de un archivo contra sus primeros bytes reales.
 */

/**
 * Firmas mágicas por tipo. El `Content-Type` lo declara quien sube; los primeros bytes del archivo
 * no mienten. Sin esta comprobación, renombrar un ejecutable a `.jpg` basta para almacenarlo.
 *
 * Esta tabla es la ÚNICA fuente: `common/storage/document-storage.service.ts` (evidencia KYC sobre
 * S3) y `common/files` (almacén local) la comparten, para que un tipo nuevo no quede verificado en
 * un camino y sin verificar en el otro.
 */
export const FILE_MAGIC_BYTES = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  // GIF87a / GIF89a: los dos dialectos comparten los tres primeros bytes pero se distinguen aquí
  // completos, para no aceptar cualquier archivo que empiece por "GIF".
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
  // WebP es un contenedor RIFF: "RIFF" + 4 bytes de tamaño + "WEBP". Los bytes 4..7 varían, así que
  // se comprueban por separado en `matchesFileMagicBytes`.
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
} as const satisfies Record<string, readonly (readonly number[])[]>;

export type KnownFileMimeType = keyof typeof FILE_MAGIC_BYTES;

export const KNOWN_FILE_MIME_TYPES = Object.keys(FILE_MAGIC_BYTES) as KnownFileMimeType[];

/** Extensión que impone el servidor. Nunca se reutiliza la del nombre que envió el cliente. */
const FILE_EXTENSIONS: Record<KnownFileMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Sufijo del contenedor RIFF que identifica a WebP frente a un WAV o un AVI. */
const WEBP_CONTAINER_TAG = [0x57, 0x45, 0x42, 0x50];

export function isKnownFileMimeType(value: string): value is KnownFileMimeType {
  return Object.prototype.hasOwnProperty.call(FILE_MAGIC_BYTES, value);
}

export function extensionForMimeType(mimeType: KnownFileMimeType): string {
  return FILE_EXTENSIONS[mimeType];
}

/**
 * `true` si los primeros bytes del buffer corresponden al tipo declarado.
 *
 * Devuelve `false` —y no lanza— ante un tipo desconocido: el llamador ya rechazó por allowlist antes
 * de llegar aquí, y una excepción en el camino de validación es más fácil de tragar por accidente
 * que un booleano.
 */
export function matchesFileMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (!isKnownFileMimeType(mimeType)) return false;

  const signatures: readonly (readonly number[])[] = FILE_MAGIC_BYTES[mimeType];
  const prefixMatches = signatures.some((signature) => signature.every((byte, index) => buffer[index] === byte));
  if (!prefixMatches) return false;

  if (mimeType === 'image/webp') {
    return WEBP_CONTAINER_TAG.every((byte, index) => buffer[8 + index] === byte);
  }
  return true;
}
