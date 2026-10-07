import { describe, expect, it } from '@jest/globals';
import { redactSecretHeaders, restoreRedactedHeaders } from '../../../src/modules/systems-ops/systems-header-redaction.util.js';
import { mapTestStep } from '../../../src/modules/systems-ops/systems-ops.mapper.js';

/**
 * Las llaves que QA pone en las cabeceras de una suite: ni salen en claro al leer el paso, ni se
 * pierden al volver a guardarlo.
 */
describe('redacción de cabeceras de las suites QA', () => {
  it('redacta por nombre las cabeceras que llevan credenciales, incluidas las `*-key`', () => {
    expect(
      redactSecretHeaders({
        'x-api-key': 'llave-de-gestion',
        'X-Platform-Catalog-Key': 'otra',
        Authorization: 'Bearer abc',
        Cookie: 'sid=1',
        'x-csrf-token': 't',
        'content-type': 'application/json',
        'x-request-id': 'r-1',
      }),
    ).toEqual({
      'x-api-key': '[REDACTED]',
      'X-Platform-Catalog-Key': '[REDACTED]',
      Authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      'x-csrf-token': '[REDACTED]',
      'content-type': 'application/json',
      'x-request-id': 'r-1',
    });
  });

  it('con `keepTemplates` conserva la referencia de plantilla, pero no un valor que sólo la contiene', () => {
    expect(
      redactSecretHeaders(
        { 'x-api-key': '{{config.apiKey}}', authorization: 'Bearer {{ context.token }}', 'x-secret': 'fijo-{{config.sufijo}}' },
        { keepTemplates: true },
      ),
    ).toEqual({ 'x-api-key': '{{config.apiKey}}', authorization: 'Bearer {{ context.token }}', 'x-secret': '[REDACTED]' });
    // Sin la opción —una corrida, con las plantillas ya resueltas— no se conserva nada.
    expect(redactSecretHeaders({ 'x-api-key': '{{config.apiKey}}' })).toEqual({ 'x-api-key': '[REDACTED]' });
  });

  it('tolera lo que no es un objeto y no deja que `__proto__` cambie el prototipo', () => {
    expect(redactSecretHeaders(null)).toEqual({});
    expect(redactSecretHeaders(['x'])).toEqual({});
    const redacted = redactSecretHeaders(JSON.parse('{"__proto__":{"polluted":true},"x-api-key":"k"}'));
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
    expect(redacted['x-api-key']).toBe('[REDACTED]');
  });

  it('mapTestStep no devuelve la llave guardada en `defaultHeaders`', () => {
    const mapped = mapTestStep({
      id: 1,
      suiteId: 2,
      endpointId: null,
      defaultHeaders: { 'x-api-key': 'llave-real', accept: 'application/json', 'x-tenant-key': '{{config.tenantKey}}' },
    } as never);
    expect(mapped.defaultHeaders).toEqual({
      'x-api-key': '[REDACTED]',
      accept: 'application/json',
      'x-tenant-key': '{{config.tenantKey}}',
    });
    expect(JSON.stringify(mapped)).not.toContain('llave-real');
  });

  it('restoreRedactedHeaders conserva lo guardado cuando la cabecera vuelve redactada', () => {
    const stored = { 'x-api-key': 'llave-real', accept: 'application/json', 'x-old-key': 'vieja' };
    expect(
      restoreRedactedHeaders(
        { 'x-api-key': '[REDACTED]', accept: 'text/plain', 'x-new-key': '[REDACTED]', 'x-other-key': 'nueva' },
        stored,
      ),
    ).toEqual({
      'x-api-key': 'llave-real', // no se tocó
      accept: 'text/plain', // se cambió
      'x-new-key': '[REDACTED]', // no había nada guardado que conservar
      'x-other-key': 'nueva',
      // `x-old-key` no vino: se quitó.
    });
    expect(restoreRedactedHeaders({ a: '[REDACTED]' }, null)).toEqual({ a: '[REDACTED]' });
  });
});
