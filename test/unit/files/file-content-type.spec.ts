import { describe, expect, it } from '@jest/globals';
import {
  KNOWN_FILE_MIME_TYPES,
  extensionForMimeType,
  isKnownFileMimeType,
  matchesFileMagicBytes,
} from '../../../src/common/files/file-content-type.util.js';
import { matchesMagicBytes } from '../../../src/common/storage/document-storage.service.js';

/**
 * Contraste entre el tipo DECLARADO y los bytes reales.
 *
 * Es la comprobación que impide almacenar un ejecutable renombrado a `.png`, así que lo que se fija
 * aquí no es la tabla concreta sino la propiedad: declarar un tipo no basta, los bytes tienen que
 * respaldarlo.
 */
function withPrefix(bytes: number[], length = 32): Buffer {
  const buffer = Buffer.alloc(length, 0x00);
  Buffer.from(bytes).copy(buffer);
  return buffer;
}

const JPEG = withPrefix([0xff, 0xd8, 0xff, 0xe0]);
const PNG = withPrefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = withPrefix([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const GIF89A = withPrefix([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const GIF87A = withPrefix([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
/** RIFF + 4 bytes de tamaño (irrelevantes) + WEBP. */
const WEBP = withPrefix([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
/** Mismo contenedor RIFF, pero es un WAV: el prefijo coincide y el tag no. */
const WAV = withPrefix([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
const ELF = withPrefix([0x7f, 0x45, 0x4c, 0x46]);

describe('matchesFileMagicBytes', () => {
  it('acepta cada tipo conocido cuando los bytes lo respaldan', () => {
    expect(matchesFileMagicBytes(JPEG, 'image/jpeg')).toBe(true);
    expect(matchesFileMagicBytes(PNG, 'image/png')).toBe(true);
    expect(matchesFileMagicBytes(PDF, 'application/pdf')).toBe(true);
    expect(matchesFileMagicBytes(GIF89A, 'image/gif')).toBe(true);
    expect(matchesFileMagicBytes(GIF87A, 'image/gif')).toBe(true);
    expect(matchesFileMagicBytes(WEBP, 'image/webp')).toBe(true);
  });

  it('rechaza un binario disfrazado con cualquiera de los tipos admitidos', () => {
    for (const mimeType of KNOWN_FILE_MIME_TYPES) {
      expect(matchesFileMagicBytes(ELF, mimeType)).toBe(false);
    }
  });

  it('rechaza el cruce entre tipos: los bytes de uno no valen para otro', () => {
    expect(matchesFileMagicBytes(PNG, 'image/jpeg')).toBe(false);
    expect(matchesFileMagicBytes(JPEG, 'application/pdf')).toBe(false);
    expect(matchesFileMagicBytes(PDF, 'image/png')).toBe(false);
  });

  it('no da por WebP a otro contenedor RIFF: el prefijo coincide, el tag no', () => {
    expect(matchesFileMagicBytes(WAV, 'image/webp')).toBe(false);
  });

  it('rechaza un tipo desconocido en vez de lanzar', () => {
    expect(matchesFileMagicBytes(JPEG, 'application/x-msdownload')).toBe(false);
    expect(matchesFileMagicBytes(JPEG, '__proto__')).toBe(false);
  });

  it('rechaza un buffer más corto que la firma, sin desbordar', () => {
    expect(matchesFileMagicBytes(Buffer.from([0xff]), 'image/jpeg')).toBe(false);
    expect(matchesFileMagicBytes(Buffer.alloc(0), 'image/png')).toBe(false);
    // WebP necesita 12 bytes: un buffer que solo llega al "RIFF" no puede darse por válido.
    expect(matchesFileMagicBytes(Buffer.from([0x52, 0x49, 0x46, 0x46]), 'image/webp')).toBe(false);
  });
});

describe('isKnownFileMimeType', () => {
  it('no confunde propiedades heredadas de Object con tipos declarados', () => {
    expect(isKnownFileMimeType('constructor')).toBe(false);
    expect(isKnownFileMimeType('toString')).toBe(false);
    expect(isKnownFileMimeType('image/png')).toBe(true);
  });
});

describe('extensionForMimeType', () => {
  it('impone una extensión propia para cada tipo conocido', () => {
    expect(KNOWN_FILE_MIME_TYPES.map((type) => extensionForMimeType(type))).toEqual(['jpg', 'png', 'pdf', 'gif', 'webp']);
  });
});

describe('compatibilidad con la evidencia documental existente', () => {
  /**
   * La tabla se compartió entre `common/files` y `common/storage`. Este bloque fija que el flujo KYC
   * sobre S3 conserva exactamente el comportamiento que tenía antes de compartirla.
   */
  it('matchesMagicBytes sigue aceptando y rechazando lo mismo que antes', () => {
    expect(matchesMagicBytes(JPEG, 'image/jpeg')).toBe(true);
    expect(matchesMagicBytes(PNG, 'image/png')).toBe(true);
    expect(matchesMagicBytes(PDF, 'application/pdf')).toBe(true);
    expect(matchesMagicBytes(ELF, 'image/jpeg')).toBe(false);
    expect(matchesMagicBytes(PNG, 'application/pdf')).toBe(false);
  });
});
