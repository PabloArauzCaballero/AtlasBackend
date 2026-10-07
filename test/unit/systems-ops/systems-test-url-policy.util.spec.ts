import { describe, expect, it } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  assertHostAllowed,
  buildAllowedTestUrl,
  isPrivateOrMetadataAddress,
} from '../../../src/modules/systems-ops/systems-test-url-policy.util.js';

/**
 * Política anti-SSRF de los tests de systems-ops. `isPrivateOrMetadataAddress` es lógica pura con
 * muchas ramas (metadata cloud, loopback, IPv6 link-local/ULA, rangos privados IPv4); las guardas de
 * protocolo/credenciales/path también son deterministas (no dependen del env allowlist).
 */
describe('systems-test-url-policy.util', () => {
  describe('isPrivateOrMetadataAddress', () => {
    it('detecta metadata de nube y loopback', () => {
      expect(isPrivateOrMetadataAddress('169.254.169.254')).toBe(true);
      expect(isPrivateOrMetadataAddress('169.254.170.2')).toBe(true);
      expect(isPrivateOrMetadataAddress('metadata.google.internal')).toBe(true);
      expect(isPrivateOrMetadataAddress('::1')).toBe(true);
      expect(isPrivateOrMetadataAddress('127.0.0.1')).toBe(true);
    });

    it('detecta IPv6 link-local (fe80) y ULA (fc/fd)', () => {
      expect(isPrivateOrMetadataAddress('fe80::1')).toBe(true);
      expect(isPrivateOrMetadataAddress('fc00::1')).toBe(true);
      expect(isPrivateOrMetadataAddress('fd12:3456::1')).toBe(true);
    });

    it('detecta rangos privados IPv4 y respeta los límites de 172.16-31', () => {
      expect(isPrivateOrMetadataAddress('10.1.2.3')).toBe(true);
      expect(isPrivateOrMetadataAddress('192.168.0.5')).toBe(true);
      expect(isPrivateOrMetadataAddress('172.16.0.1')).toBe(true);
      expect(isPrivateOrMetadataAddress('172.31.255.255')).toBe(true);
      expect(isPrivateOrMetadataAddress('172.32.0.1')).toBe(false); // fuera del rango
      expect(isPrivateOrMetadataAddress('0.0.0.0')).toBe(true);
    });

    it('trata como públicas las IP externas y como no-IP los hostnames arbitrarios', () => {
      expect(isPrivateOrMetadataAddress('8.8.8.8')).toBe(false);
      expect(isPrivateOrMetadataAddress('203.0.113.10')).toBe(false);
      expect(isPrivateOrMetadataAddress('example.com')).toBe(false); // no son 4 octetos
      expect(isPrivateOrMetadataAddress('999.1.1.1')).toBe(false); // octeto inválido
    });

    it('detecta CGNAT/Tailscale y los rangos reservados 192.0.0/24 y 198.18/15', () => {
      expect(isPrivateOrMetadataAddress('100.101.207.88')).toBe(true);
      expect(isPrivateOrMetadataAddress('100.64.0.1')).toBe(true);
      expect(isPrivateOrMetadataAddress('100.127.255.255')).toBe(true);
      expect(isPrivateOrMetadataAddress('100.128.0.1')).toBe(false);
      expect(isPrivateOrMetadataAddress('192.0.0.8')).toBe(true);
      expect(isPrivateOrMetadataAddress('198.18.0.1')).toBe(true);
      expect(isPrivateOrMetadataAddress('198.19.255.1')).toBe(true);
      expect(isPrivateOrMetadataAddress('198.20.0.1')).toBe(false);
    });

    it('desenvuelve las IPv4 mapeadas en IPv6, también en la forma hex que deja new URL', () => {
      expect(isPrivateOrMetadataAddress('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrMetadataAddress('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateOrMetadataAddress(new URL('http://[::ffff:10.0.0.1]/').hostname)).toBe(true);
      expect(isPrivateOrMetadataAddress('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254
      expect(isPrivateOrMetadataAddress('::ffff:8.8.8.8')).toBe(false);
      expect(isPrivateOrMetadataAddress('0:0:0:0:0:0:0:1')).toBe(true);
      expect(isPrivateOrMetadataAddress('::')).toBe(true);
      expect(isPrivateOrMetadataAddress('fe80::1%eth0')).toBe(true);
    });

    it('no confunde nombres de host que empiezan por fc/fd con IPv6 ULA', () => {
      expect(isPrivateOrMetadataAddress('fcm.example.com')).toBe(false);
      expect(isPrivateOrMetadataAddress('fd-api.atlas.bo')).toBe(false);
      expect(isPrivateOrMetadataAddress('2001:4860::8888')).toBe(false);
    });
  });

  describe('assertHostAllowed (guardas deterministas)', () => {
    it('rechaza protocolos no http/https', () => {
      expect(() => assertHostAllowed(new URL('ftp://host/x'), 'LOCAL')).toThrow(ForbiddenException);
    });
    it('rechaza URLs con credenciales embebidas', () => {
      expect(() => assertHostAllowed(new URL('http://user:pass@host/x'), 'LOCAL')).toThrow(ForbiddenException);
    });
  });

  describe('buildAllowedTestUrl (validación de path)', () => {
    it('exige que el path sea relativo y no protocol-relative', () => {
      expect(() => buildAllowedTestUrl('http://localhost:3000', 'sin-slash', 'LOCAL')).toThrow(ForbiddenException);
      expect(() => buildAllowedTestUrl('http://localhost:3000', '//evil.com/x', 'LOCAL')).toThrow(ForbiddenException);
    });
  });
});
