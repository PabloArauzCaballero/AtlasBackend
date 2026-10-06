import { describe, expect, it } from '@jest/globals';
import { redactPathSecrets } from '../../../../src/common/utils/privacy/path-secret-redaction.util.js';
import { sanitizeUrlForLog } from '../../../../src/common/filters/http-exception.filter.js';

describe('redactPathSecrets', () => {
  it('reemplaza el secreto del webhook de Brevo en la ruta', () => {
    expect(redactPathSecrets('/api/v1/internal/notifications/brevo-sms-events/s3cr3t')).toBe(
      '/api/v1/internal/notifications/brevo-sms-events/[REDACTED]',
    );
  });

  it('no toca rutas sin secreto', () => {
    expect(redactPathSecrets('/api/v1/customers/1')).toBe('/api/v1/customers/1');
  });

  it('sanitizeUrlForLog lo aplica con y sin query', () => {
    const base = '/api/v1/internal/notifications/brevo-sms-events/s3cr3t';
    expect(sanitizeUrlForLog(base)).not.toContain('s3cr3t');
    expect(sanitizeUrlForLog(`${base}?a=1`)).not.toContain('s3cr3t');
  });
});
