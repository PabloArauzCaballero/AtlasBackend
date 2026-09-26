/**
 * @file AT-047 — identidad y autorización entre límites: el tenant viene del token, nunca de una cabecera.
 * @business Un `x-tenant-id` manipulado no cruza tenant; un token con audiencia o emisor incorrectos se rechaza.
 * @system Guards reales (`TenantGuard`, verificación JWT con `accessTokenVerifyOptions`) y `RequestContext`.
 */
import { describe, expect, it } from '@jest/globals';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { TenantGuard } from '../../../src/common/guards/tenant.guard.js';
import { accessTokenSignOptions, accessTokenVerifyOptions } from '../../../src/common/utils/auth/jwt-claims.util.js';
import { env } from '../../../src/config/env.js';
import { buildRequestContext } from '../../../src/platform/contracts/request-context.js';

const context = (request: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('autorización entre límites (AT-047)', () => {
  it('x-tenant-id manipulado con sesión de otro tenant: TenantGuard deniega; el contexto mantiene el tenant del token', () => {
    const guard = new TenantGuard();
    const request = { headers: { 'x-tenant-id': '999' }, user: { sub: 's', role: 'customer', tenantId: '1' } };
    expect(() => guard.canActivate(context(request))).toThrow(ForbiddenException);
    const ctx = buildRequestContext({ user: request.user as never, headers: request.headers });
    expect(ctx.tenantId).toBe('1');
    expect(ctx.hintedTenantId).toBe('999');
  });

  it('token de servicio con audiencia o emisor incorrectos: la verificación lo rechaza', () => {
    const good = jwt.sign({ sub: 'svc' }, env.JWT_ACCESS_TOKEN_SECRET, accessTokenSignOptions({ algorithm: 'HS256', expiresIn: '1m' }));
    const wrongAudience = jwt.sign({ sub: 'svc' }, env.JWT_ACCESS_TOKEN_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1m',
      issuer: env.JWT_ISSUER,
      audience: 'otro-servicio',
    });
    const wrongAlgorithm = jwt.sign({ sub: 'svc' }, env.JWT_ACCESS_TOKEN_SECRET, {
      algorithm: 'HS512',
      expiresIn: '1m',
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    expect(() => jwt.verify(good, env.JWT_ACCESS_TOKEN_SECRET, accessTokenVerifyOptions())).not.toThrow();
    expect(() => jwt.verify(wrongAudience, env.JWT_ACCESS_TOKEN_SECRET, accessTokenVerifyOptions())).toThrow(/audience/);
    expect(() => jwt.verify(wrongAlgorithm, env.JWT_ACCESS_TOKEN_SECRET, accessTokenVerifyOptions())).toThrow(/algorithm/);
  });

  it('sin usuario autenticado, la cabecera no otorga tenant (onboarding público resuelve el tenant por su propia vía)', () => {
    const ctx = buildRequestContext({ headers: { 'x-tenant-id': '7' } });
    expect(ctx.tenantId).toBeNull();
    expect(ctx.actor.type).toBe('anonymous');
  });
});
