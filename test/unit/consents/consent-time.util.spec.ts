import { describe, expect, it } from '@jest/globals';
import { consentHappenedAt } from '../../../src/modules/consents/consent-time.util.js';

describe('consentHappenedAt', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');

  it('sin hora del cliente usa la del servidor', () => {
    expect(consentHappenedAt(undefined, now)).toBe(now);
  });

  it('acepta una hora reciente del cliente (captura sin conexión)', () => {
    expect(consentHappenedAt('2026-10-05T09:00:00.000Z', now).toISOString()).toBe('2026-10-05T09:00:00.000Z');
  });

  it('una hora futura no se acepta', () => {
    expect(consentHappenedAt('2026-10-06T12:00:00.000Z', now)).toBe(now);
  });

  it('una hora de hace meses no se acepta: el consentimiento no puede ser anterior a su documento', () => {
    expect(consentHappenedAt('2020-01-01T00:00:00.000Z', now)).toBe(now);
  });

  it('una cadena que no es fecha cae a la hora del servidor', () => {
    expect(consentHappenedAt('no-es-fecha', now)).toBe(now);
  });
});
