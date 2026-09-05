/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system construye las claves del almacén de objetos con una sola regla para todos los flujos.
 */
import { randomUUID } from 'node:crypto';

/**
 * La forma de una clave de objeto, en un solo sitio.
 *
 * Había DOS implementaciones de lo mismo —`DocumentStorageService.createUploadTicket` para la
 * evidencia KYC y `MinioFileStorageAdapter.buildStorageKey` para el servicio de archivos— con
 * saneados distintos: una recortaba a 64 caracteres por segmento y la otra no, una admitía puntos
 * y la otra los convertía en guiones bajos. Mientras cada flujo escribía en su propio prefijo eso
 * no se notaba; con un explorador que lista y borra objetos de los dos, una clave que se escribe
 * con un nombre y se lee con otro es un archivo perdido.
 *
 * No cambia ninguna clave ya escrita: el saneado es el mismo que ya aplicaba el adaptador, y la
 * evidencia KYC nunca metió caracteres fuera del alfabeto seguro (sus segmentos son identificadores
 * numéricos y tipos de documento del enum).
 */

/** Tope por segmento. Una ruta de S3 admite 1024 bytes en total; 64 por tramo deja sitio de sobra. */
const MAX_SEGMENT = 64;

/**
 * Reduce un segmento al alfabeto seguro.
 *
 * En un almacén de objetos la clave es una cadena, no una ruta, así que no hay travesía de
 * directorios que temer. Lo que sí hay son claves que cada cliente de S3 codifica distinto —el
 * espacio, el acento, el signo de interrogación— y ahí es donde un objeto se vuelve irrecuperable.
 */
export function safeKeySegment(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned.slice(0, MAX_SEGMENT) : 'unknown';
}

/** La extensión, saneada y sin punto. Sale del tipo YA VERIFICADO, nunca del nombre que subió alguien. */
export function safeExtension(value: string): string {
  const cleaned = value.trim().replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 12) : 'bin';
}

/**
 * Clave con la ruta que IMPONE el servidor.
 *
 * El `uuid` final es lo que impide que dos subidas del mismo documento se pisen, y lo que permite
 * que renombrar o mover un archivo en el explorador sea un `UPDATE` en la base y no una copia de
 * bytes: el nombre visible vive en el catálogo, la clave no cambia nunca.
 */
export function buildStorageKey(input: { segments: readonly string[]; extension: string; prefix?: string }): string {
  const prefix = (input.prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
  return [
    ...(prefix ? [prefix] : []),
    ...input.segments.map((segment) => safeKeySegment(segment)),
    `${randomUUID()}.${safeExtension(input.extension)}`,
  ].join('/');
}

/** Extensión canónica de los tipos que el sistema acepta. Nunca se deduce del nombre del archivo. */
export function extensionForContentType(contentType: string): string {
  const normalized = contentType.trim().toLowerCase();
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'application/json') return 'json';
  return 'jpg';
}
