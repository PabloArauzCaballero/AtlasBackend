/**
 * @file AT-010 — contrato de la política de idempotencia: huella semántica, ámbito y replay por operación.
 * @business Una clave repetida con un campo sensible distinto es un conflicto, no un replay; la
 *   respuesta de un login no se reproduce nunca; y nadie recibe el replay de otra persona.
 * @system Funciones puras (`idempotency-policy.ts`); sin base ni Nest. La matriz de operaciones de
 *   abajo es el contrato: ampliar la lista de rutas de credenciales exige ampliar esta prueba.
 */
import { describe, expect, it } from '@jest/globals';
import {
  classifyOperation,
  fingerprintMatches,
  fingerprintRequest,
  legacyFingerprint,
  operationPolicy,
  sameActor,
} from '../../../src/modules/runtime-hardening/application/idempotency-policy.js';

const SECRET = 'contract-test-secret-with-at-least-32-characters';

describe('huella semántica', () => {
  it('misma clave y payload semánticamente distinto en un campo sensible: huellas distintas (conflicto)', () => {
    // Con la huella anterior (SHA-256 del cuerpo REDACTADO) estos dos cuerpos colapsaban.
    const a = fingerprintRequest({ body: { password: 'uno', otp: '111111' }, query: {}, params: {} }, SECRET);
    const b = fingerprintRequest({ body: { password: 'dos', otp: '222222' }, query: {}, params: {} }, SECRET);
    expect(a).not.toBe(b);
    expect(legacyFingerprint({ body: { password: 'uno' }, query: {}, params: {} })).toBe(
      legacyFingerprint({ body: { password: 'dos' }, query: {}, params: {} }),
    );
  });

  it('es estable ante el orden de claves y va versionada', () => {
    const a = fingerprintRequest({ body: { b: 2, a: 1 }, query: { z: 1 }, params: {} }, SECRET);
    const b = fingerprintRequest({ body: { a: 1, b: 2 }, query: { z: 1 }, params: {} }, SECRET);
    expect(a).toBe(b);
    expect(a.startsWith('v2:')).toBe(true);
  });

  it('cambia con el secreto: rotarlo invalida los replays vigentes a propósito', () => {
    const request = { body: { a: 1 }, query: {}, params: {} };
    expect(fingerprintRequest(request, SECRET)).not.toBe(fingerprintRequest(request, `${SECRET}-rotado`));
  });

  it('una fila escrita con la huella anterior (sin prefijo) sigue comparándose con su algoritmo', () => {
    const request = { body: { customerId: '1', amount: '10.00' }, query: {}, params: {} };
    expect(fingerprintMatches(legacyFingerprint(request), request, SECRET)).toBe(true);
    expect(fingerprintMatches(fingerprintRequest(request, SECRET), request, SECRET)).toBe(true);
    expect(fingerprintMatches('v2:otra', request, SECRET)).toBe(false);
  });
});

describe('matriz de operaciones', () => {
  it.each([
    ['POST /api/v1/auth/login', 'credentials'],
    ['POST /api/v1/auth/refresh', 'credentials'],
    ['POST /api/v1/internal/auth/logout', 'credentials'],
    ['POST /api/v1/customers/1/contact-methods/2/verification-code', 'credentials'],
    ['POST /api/v1/customers/1/password', 'credentials'],
    ['POST /api/v1/onboarding/otp', 'credentials'],
    ['POST /api/v1/credit/applications', 'mutation'],
    ['PATCH /api/v1/customers/1/profile', 'mutation'],
    ['POST /api/v1/notifications/broadcast', 'mutation'],
    ['DELETE /api/v1/authors/1', 'mutation'],
  ])('%s → %s', (scope, expected) => {
    expect(classifyOperation(scope)).toBe(expected);
  });

  it('las mutaciones ordinarias guardan y reproducen la respuesta; las de credenciales no', () => {
    expect(operationPolicy('POST /api/v1/credit/applications')).toEqual({ operation: 'mutation', storeResponse: true });
    expect(operationPolicy('POST /api/v1/auth/login')).toEqual({ operation: 'credentials', storeResponse: false });
  });
});

describe('ámbito por actor', () => {
  it('replay sólo para el mismo actor; dos anónimos del mismo tenant y clave son el mismo llamador', () => {
    expect(sameActor('cust-1', 'cust-1')).toBe(true);
    expect(sameActor('cust-1', 'cust-2')).toBe(false);
    expect(sameActor(null, null)).toBe(true);
    expect(sameActor(null, 'cust-1')).toBe(false);
    expect(sameActor('cust-1', null)).toBe(false);
  });
});
