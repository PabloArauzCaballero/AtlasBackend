/**
 * @file Utilidad pura: los bytes que una persona sintética sube al almacenamiento QA.
 * @business Esta pieza hace que cada persona suba un JPEG real y distinto, del tamaño exacto que la
 *   URL firmada exige, sin tocar una imagen de nadie.
 * @system inserta un segmento COM (comentario JPEG) tras el SOI: el archivo sigue siendo válido y el
 *   comentario lleva la persona, así que dos personas nunca suben el mismo hash.
 */
import { createHash } from 'node:crypto';
import { SYNTHETIC_IDENTITY_IMAGES, type SyntheticImageKind } from './synthetic-identity-images.js';

/** Tamaño que declaran las recetas al pedir la URL: holgado sobre las imágenes base (~6 KB). */
export const SYNTHETIC_UPLOAD_BYTES = 8192;

export function syntheticImage(
  kind: SyntheticImageKind,
  personaKey: string,
  size = SYNTHETIC_UPLOAD_BYTES,
): { bytes: Uint8Array; sha256: string } {
  const base = Buffer.from(SYNTHETIC_IDENTITY_IMAGES[kind].base64, 'base64');
  const payloadLength = size - base.length - 4;
  if (payloadLength < 0 || payloadLength > 65_533) throw new Error(`SYNTHETIC_UPLOAD_SIZE_INVALID:${size}`);
  const label = Buffer.from(`atlas-qa ${kind} ${personaKey} `, 'utf8');
  const payload = Buffer.alloc(payloadLength, 0x20);
  label.copy(payload, 0, 0, Math.min(label.length, payloadLength));
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xfffe, 0);
  segment.writeUInt16BE(payloadLength + 2, 2);
  const bytes = Buffer.concat([base.subarray(0, 2), segment, payload, base.subarray(2)]);
  return { bytes: new Uint8Array(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
}
