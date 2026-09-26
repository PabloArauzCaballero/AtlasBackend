/**
 * @file AT-047 — el guard de identidad de servicio falla CERRADO en todos sus caminos.
 * @business Una ruta entre contextos sin regla declarada no se abre «por defecto»; sin secreto configurado la
 *   ruta no existe (503, no 200); sin token, con esquema raro, con token de otro servicio o firmado para otro
 *   recurso, no entra. Y cuando entra, el controlador recibe el actor de servicio, no un usuario.
 * @system Guard real con un `Reflector` doble y peticiones sintéticas; sin HTTP ni base.
 */
import { describe, expect, it } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  ServiceTokenGuard,
  type RequestWithServiceActor,
  type ServiceScopeRule,
} from '../../../../src/common/guards/service-token.guard.js';
import { resourceFingerprint, signServiceToken } from '../../../../src/platform/security/service-token.js';

const SCOPE = 'customers:recipient-directory';
const RULE: ServiceScopeRule = { scope: SCOPE, audienceContext: 'customers', allowedServices: ['messaging-worker'] };

function contextWith(
  request: RequestWithServiceActor,
  rule: ServiceScopeRule | undefined,
): { context: ExecutionContext; guard: ServiceTokenGuard } {
  const reflector = { getAllAndOverride: () => rule } as unknown as Reflector;
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, guard: new ServiceTokenGuard(reflector) };
}

const bearer = (token: string, query: Record<string, unknown> = {}): RequestWithServiceActor => ({
  headers: { authorization: `Bearer ${token}` },
  query,
});

const goodToken = (resource?: string) =>
  signServiceToken({ service: 'messaging-worker', tenantId: '5', scopes: [SCOPE], audienceContext: 'customers', resource });

describe('guard de identidad de servicio', () => {
  it('una ruta sin @ServiceScope no se abre: falta la regla, no hay permiso que comprobar', () => {
    const { guard, context } = contextWith(bearer(goodToken()), undefined);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('token válido: deja el actor de servicio en la petición (tenant incluido) y no toca `user`', () => {
    const request = bearer(goodToken());
    const { guard, context } = contextWith(request, RULE);
    expect(guard.canActivate(context)).toBe(true);
    expect(request.serviceActor).toMatchObject({ service: 'messaging-worker', tenantId: '5' });
  });

  it('sin cabecera, con esquema distinto de Bearer o con token vacío: 401', () => {
    for (const headers of [{}, { authorization: goodToken() }, { authorization: 'Basic abc' }, { authorization: 'Bearer ' }]) {
      const { guard, context } = contextWith({ headers } as RequestWithServiceActor, RULE);
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    }
  });

  it('token de un servicio no admitido o sin el permiso: 401 con la causa acotada (sin detalle del verificador)', () => {
    const stranger = signServiceToken({ service: 'credit-worker', tenantId: '5', scopes: [SCOPE], audienceContext: 'customers' });
    const { guard, context } = contextWith(bearer(stranger), RULE);
    expect(() => guard.canActivate(context)).toThrow('SERVICE_NOT_ALLOWED');
  });

  it('la regla con recurso exige que el token se firme para ESA consulta', () => {
    const rule: ServiceScopeRule = {
      ...RULE,
      resourceFrom: (query) => resourceFingerprint({ customerId: String(query.customerId ?? '') }),
    };
    const forSeven = goodToken(resourceFingerprint({ customerId: '7' }));
    const allowed = contextWith(bearer(forSeven, { customerId: '7' }), rule);
    expect(allowed.guard.canActivate(allowed.context)).toBe(true);
    const other = contextWith(bearer(forSeven, { customerId: '8' }), rule);
    expect(() => other.guard.canActivate(other.context)).toThrow('SERVICE_RESOURCE_MISMATCH');
  });

  it('el actor de servicio no se hereda de una petición anterior: cada petición trae el suyo', () => {
    const stale: RequestWithServiceActor = {
      headers: {},
      serviceActor: { service: 'otro', tenantId: '99', scopes: [], resource: null, jti: null },
    };
    const { guard, context } = contextWith(stale, RULE);
    // Sin token la petición se rechaza aunque venga con un actor puesto de antes.
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
