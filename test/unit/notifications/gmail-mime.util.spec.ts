import { describe, expect, it } from '@jest/globals';
import {
  buildGmailRawMessage,
  encodeHeaderValue,
  isValidEmailAddress,
} from '../../../src/modules/notifications/adapters/gmail/gmail-mime.util.js';

/** Decodifica el `raw` base64url que consume `gmail.users.messages.send`. */
function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function decodeBase64Body(block: string): string {
  return Buffer.from(block.split(/\r\n/).join(''), 'base64').toString('utf8');
}

describe('gmail-mime.util', () => {
  const base = { from: 'atlas@example.com', to: ['dest@example.com'], subject: 'Hola', text: 'cuerpo', boundarySeed: 'msg-1' };

  describe('encodeHeaderValue', () => {
    it('deja pasar ASCII imprimible sin tocarlo', () => {
      expect(encodeHeaderValue('Verificacion de cuenta')).toBe('Verificacion de cuenta');
    });

    it('codifica en RFC 2047 cuando hay caracteres no ASCII', () => {
      const encoded = encodeHeaderValue('Verificación');
      expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(Buffer.from(encoded.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf8')).toBe('Verificación');
    });

    it('pliega en varios encoded-word y ninguno excede los 75 chars de RFC 2047', () => {
      const encoded = encodeHeaderValue('áéíóú'.repeat(30));
      const words = encoded.split('\r\n ');
      expect(words.length).toBeGreaterThan(1);
      for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
      expect(words.map((word) => Buffer.from(word.slice(10, -2), 'base64').toString('utf8')).join('')).toBe('áéíóú'.repeat(30));
    });

    it('no parte un carácter multibyte entre dos encoded-word', () => {
      // Emoji de 4 bytes: si el corte fuera por unidad UTF-16 aparecerían reemplazos U+FFFD.
      const value = '🚀'.repeat(40);
      const decoded = encodeHeaderValue(value)
        .split('\r\n ')
        .map((word) => Buffer.from(word.slice(10, -2), 'base64').toString('utf8'))
        .join('');
      expect(decoded).toBe(value);
      expect(decoded).not.toContain('�');
    });

    it('neutraliza inyección de cabeceras por salto de línea', () => {
      const encoded = encodeHeaderValue('Asunto\r\nBcc: atacante@evil.com');
      expect(encoded).toBe('Asunto Bcc: atacante@evil.com');
      expect(encoded).not.toContain('\n');
    });
  });

  describe('isValidEmailAddress', () => {
    it('acepta direcciones normales y rechaza las que romperían la cabecera', () => {
      expect(isValidEmailAddress('dest@example.com')).toBe(true);
      expect(isValidEmailAddress('nombre.apellido+tag@sub.example.co')).toBe(true);
      expect(isValidEmailAddress('a@x.com, atacante@evil.com')).toBe(false);
      expect(isValidEmailAddress('a@x.com\r\nBcc: evil@x.com')).toBe(false);
      expect(isValidEmailAddress('<a@x.com>')).toBe(false);
      expect(isValidEmailAddress('sin-arroba')).toBe(false);
      expect(isValidEmailAddress('a@sin-tld')).toBe(false);
    });
  });

  describe('buildGmailRawMessage', () => {
    it('mensaje de solo texto: cabeceras mínimas y cuerpo base64 recuperable', () => {
      const decoded = decodeRaw(buildGmailRawMessage({ ...base, text: 'línea uno\r\nlínea dos' }));
      expect(decoded).toContain('From: atlas@example.com\r\n');
      expect(decoded).toContain('To: dest@example.com\r\n');
      expect(decoded).toContain('Subject: Hola\r\n');
      expect(decoded).toContain('MIME-Version: 1.0\r\n');
      expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"\r\n');
      const [, body] = decoded.split('\r\n\r\n');
      expect(decodeBase64Body(body)).toBe('línea uno\r\nlínea dos');
    });

    it('con html emite multipart/alternative con ambas partes íntegras', () => {
      const decoded = decodeRaw(buildGmailRawMessage({ ...base, html: '<p>hola ñ</p>' }));
      const boundary = decoded.match(/boundary="([^"]+)"/)?.[1];
      expect(boundary).toBe('atlas-msg1');
      const parts = decoded.split(`--${boundary}`);
      expect(decoded).toContain(`--${boundary}--`);
      expect(decodeBase64Body(parts[1].split('\r\n\r\n')[1])).toBe('cuerpo');
      expect(decodeBase64Body(parts[2].split('\r\n\r\n')[1])).toBe('<p>hola ñ</p>');
    });

    it('omite Cc/Bcc/Reply-To cuando vienen vacíos y los emite cuando no', () => {
      expect(decodeRaw(buildGmailRawMessage({ ...base, cc: [], bcc: [] }))).not.toContain('Cc:');
      const decoded = decodeRaw(buildGmailRawMessage({ ...base, cc: ['c@x.com', 'd@x.com'], bcc: ['e@x.com'], replyTo: 'reply@x.com' }));
      expect(decoded).toContain('Cc: c@x.com, d@x.com\r\n');
      expect(decoded).toContain('Bcc: e@x.com\r\n');
      expect(decoded).toContain('Reply-To: reply@x.com\r\n');
    });

    it('ninguna línea del cuerpo base64 excede los 76 chars de RFC 2045', () => {
      const decoded = decodeRaw(buildGmailRawMessage({ ...base, text: 'x'.repeat(5000) }));
      for (const line of decoded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    });

    it('una semilla sin caracteres válidos degrada a un boundary por defecto', () => {
      const decoded = decodeRaw(buildGmailRawMessage({ ...base, boundarySeed: '///', html: '<p>x</p>' }));
      expect(decoded).toContain('boundary="atlas-boundary"');
    });
  });
});
