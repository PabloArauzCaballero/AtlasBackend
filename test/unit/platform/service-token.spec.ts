/**
 * @file Identidad de servicio entre contextos (AT-047): audiencia por destino, servicio admitido, permiso y tenant.
 * @business Un token de servicio para Clientes no sirve para otro contexto; un servicio no admitido no entra
 *   aunque tenga el secreto; sin el permiso o sin tenant, tampoco.
 * @system Firma y verificación puras con el secreto de prueba del entorno de jest.
 */
import { describe, expect, it } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { env } from '../../../src/config/env.js';
import {
  contextAudience,
  resourceFingerprint,
  signServiceToken,
  verifyServiceToken,
} from '../../../src/platform/security/service-token.js';

const expected = { audienceContext: 'customers', scope: 'customers:recipient-directory', allowedServices: ['messaging-worker'] };

describe('token de servicio entre contextos', () => {
  it('firma y verifica con audiencia del contexto destino; devuelve servicio, tenant y permisos', () => {
    const token = signServiceToken({ service: 'messaging-worker', tenantId: '7', scopes: [expected.scope], audienceContext: 'customers' });
    expect(jwt.decode(token)).toMatchObject({
      aud: contextAudience('customers'),
      iss: env.JWT_ISSUER,
      svc: 'messaging-worker',
      sub: 'service:messaging-worker',
    });
    expect(verifyServiceToken(token, expected)).toEqual({
      ok: true,
      claims: { service: 'messaging-worker', tenantId: '7', scopes: [expected.scope], resource: null, jti: expect.any(String) },
    });
  });

  it('el token está atado al recurso: uno firmado para otro cliente o propósito no vale (hallazgo A7)', () => {
    const forCustomer7 = resourceFingerprint({ customerId: '7', channel: 'sms', purpose: 'transactional' });
    const forCustomer9 = resourceFingerprint({ customerId: '9', channel: 'sms', purpose: 'transactional' });
    const token = signServiceToken({
      service: 'messaging-worker',
      tenantId: '1',
      scopes: [expected.scope],
      audienceContext: 'customers',
      resource: forCustomer7,
    });
    expect(verifyServiceToken(token, { ...expected, resource: forCustomer7 }).ok).toBe(true);
    expect(verifyServiceToken(token, { ...expected, resource: forCustomer9 })).toEqual({ ok: false, reason: 'SERVICE_RESOURCE_MISMATCH' });
    // Un token genérico (sin recurso) no sirve para una ruta que exige recurso.
    const generic = signServiceToken({
      service: 'messaging-worker',
      tenantId: '1',
      scopes: [expected.scope],
      audienceContext: 'customers',
    });
    expect(verifyServiceToken(generic, { ...expected, resource: forCustomer7 })).toEqual({
      ok: false,
      reason: 'SERVICE_RESOURCE_MISMATCH',
    });
  });

  it('cada token lleva su propio jti y la huella no depende del orden de los parámetros', () => {
    const a = signServiceToken({ service: 'messaging-worker', tenantId: '1', scopes: [expected.scope], audienceContext: 'customers' });
    const b = signServiceToken({ service: 'messaging-worker', tenantId: '1', scopes: [expected.scope], audienceContext: 'customers' });
    const claims = (token: string) => {
      const result = verifyServiceToken(token, expected);
      if (!result.ok) throw new Error(result.reason);
      return result.claims;
    };
    expect(claims(a).jti).not.toBe(claims(b).jti);
    expect(resourceFingerprint({ b: '2', a: '1' })).toBe(resourceFingerprint({ a: '1', b: '2' }));
  });

  it('otra audiencia (otro contexto o la API de usuarios) → rechazado', () => {
    const other = signServiceToken({ service: 'messaging-worker', tenantId: '7', scopes: [expected.scope], audienceContext: 'credit' });
    expect(verifyServiceToken(other, expected)).toMatchObject({ ok: false, reason: expect.stringContaining('SERVICE_TOKEN_INVALID') });
    const user = jwt.sign({ sub: 'u', role: 'admin', tenantId: '7' }, env.JWT_ACCESS_TOKEN_SECRET, {
      algorithm: 'HS256',
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    expect(verifyServiceToken(user, expected).ok).toBe(false);
  });

  it('servicio no admitido, permiso ausente o tenant ausente → rechazado con la causa', () => {
    const stranger = signServiceToken({ service: 'credit-worker', tenantId: '7', scopes: [expected.scope], audienceContext: 'customers' });
    expect(verifyServiceToken(stranger, expected)).toEqual({ ok: false, reason: 'SERVICE_NOT_ALLOWED' });
    const noScope = signServiceToken({ service: 'messaging-worker', tenantId: '7', scopes: ['other'], audienceContext: 'customers' });
    expect(verifyServiceToken(noScope, expected)).toEqual({ ok: false, reason: 'SERVICE_SCOPE_MISSING' });
    const noTenant = signServiceToken({
      service: 'messaging-worker',
      tenantId: '',
      scopes: [expected.scope],
      audienceContext: 'customers',
    });
    expect(verifyServiceToken(noTenant, expected)).toEqual({ ok: false, reason: 'SERVICE_TOKEN_TENANT_MISSING' });
  });

  it('expirado o con otro secreto → rechazado; sin secreto configurado → deshabilitado', () => {
    const expired = signServiceToken({
      service: 'messaging-worker',
      tenantId: '7',
      scopes: [expected.scope],
      audienceContext: 'customers',
      ttlSeconds: -1,
    });
    expect(verifyServiceToken(expired, expected).ok).toBe(false);
    const forged = signServiceToken({
      service: 'messaging-worker',
      tenantId: '7',
      scopes: [expected.scope],
      audienceContext: 'customers',
      secret: 'another-secret-with-at-least-32-characters!!',
    });
    expect(verifyServiceToken(forged, expected).ok).toBe(false);
    expect(verifyServiceToken(forged, { ...expected, secret: '' })).toEqual({ ok: false, reason: 'SERVICE_TOKENS_DISABLED' });
  });
});
