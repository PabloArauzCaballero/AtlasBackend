import { describe, expect, it } from '@jest/globals';
import { redactSensitiveObject, stableStringify } from '../../src/common/utils/privacy/redaction.util.js';

describe('redactSensitiveObject', () => {
  it('redacts sensitive nested fields but keeps safe fields visible', () => {
    const result = redactSensitiveObject({
      email: 'demo@atlas.test',
      profile: { firstName: 'Ana', phone: '+59170000000' },
      safe: 'visible',
    }) as Record<string, unknown>;

    expect(result.email).toBe('[REDACTED]');
    // Hardening 2026-07-21 (S-M1): en un backend KYC el nombre del cliente es PII. Esta utilidad
    // solo se aplica a payloads PERSISTIDOS de auditoría/telemetría (no a los DTOs de display, que
    // no pasan por aquí), así que firstName/lastName/fullName ahora también se redactan.
    expect(result.profile).toEqual({ firstName: '[REDACTED]', phone: '[REDACTED]' });
    expect(result.safe).toBe('visible');
  });

  it('redacts the login `identifier` (email/teléfono) — el leak concreto de S-M1', () => {
    const result = redactSensitiveObject({ identifier: 'demo@atlas.test', deviceId: 'abc' }) as Record<string, unknown>;
    expect(result.identifier).toBe('[REDACTED]');
    // Claves técnicas con sufijo/prefijo "name" NO se redactan (solo `^name$` exacto).
    expect(result.deviceId).toBe('abc');
  });

  it('does not over-redact technical *Name keys (jobName, screenName)', () => {
    // jobName/screenName no contienen ninguna clave sensible como substring ni son `^name$` exacto.
    // (templateName se omite a propósito: colisiona con la regla `lat` — ver docstring del util.)
    const result = redactSensitiveObject({ jobName: 'sync', screenName: 'home' }) as Record<string, unknown>;
    expect(result.jobName).toBe('sync');
    expect(result.screenName).toBe('home');
  });
});

describe('stableStringify', () => {
  it('keeps deterministic key order regardless of insertion order', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });
});
