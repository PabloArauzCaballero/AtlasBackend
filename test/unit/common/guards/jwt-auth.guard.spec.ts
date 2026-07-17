import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard.js';
import { TokenRevocationService } from '../../../../src/common/services/token-revocation.service.js';
import { env } from '../../../../src/config/env.js';
import { RequestWithAuth } from '../../../../src/common/types/auth.types.js';

/**
 * Fase 3 (auditoría de cobertura): `JwtAuthGuard` estaba en 0% de cobertura. Es la puerta de
 * autenticación de TODO el backend (salvo endpoints @Public) e incluye la
 * comprobación de `tokenVersion` contra `TokenRevocationService` (un token robado o de un usuario
 * que cambió de contraseña debe dejar de servir). Sin tests, un regresión aquí podría hacer que
 * tokens revocados sigan siendo aceptados sin que nada lo detecte hasta un incidente real.
 *
 * Nivel de importancia: SISTEMA (autenticación transversal), con impacto de NEGOCIO/seguridad
 * directo: si `tokenVersion` deja de compararse, un token robado tras un cambio de contraseña
 * sigue siendo válido — afecta a cualquier endpoint de negocio (compras, KYC, riesgo, etc.).
 */

function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, env.JWT_ACCESS_TOKEN_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
}

function buildContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: Partial<RequestWithAuth>;
  reflector: Reflector;
} {
  const reflector = { getAllAndOverride: jest.fn(() => false) } as unknown as Reflector; // isPublic = false

  const request: Partial<RequestWithAuth> = { headers };

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request, reflector };
}

function buildRevocationServiceMock(currentVersion: number | null) {
  return {
    getCurrentTokenVersion: jest.fn(async () => currentVersion),
  } as unknown as TokenRevocationService;
}

describe('JwtAuthGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rechaza si no hay header Authorization', async () => {
    const { context, reflector } = buildContext({});
    const guard = new JwtAuthGuard(reflector, buildRevocationServiceMock(null));

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  /**
   * Sesión por cookie `HttpOnly`: es la vía del panel interno desde que los tokens dejaron de
   * viajar en el body. Si el guard dejara de leer la cookie, el portal entero quedaría sin
   * autenticar; si dejara de aceptar el header, se romperían los smoke tests y scripts.
   */
  describe('sesión por cookie HttpOnly', () => {
    it('acepta el token desde la cookie de acceso, sin header Authorization', async () => {
      const token = signToken({ sub: 'int-1', role: 'internal_operator', internalUserId: '1' });
      const { context, request, reflector } = buildContext({ cookie: `atlas_internal_access=${token}` });
      const guard = new JwtAuthGuard(reflector, buildRevocationServiceMock(null));

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user?.sub).toBe('int-1');
    });

    it('la cookie tiene prioridad sobre el header Authorization', async () => {
      const cookieToken = signToken({ sub: 'desde-cookie', role: 'internal_operator', internalUserId: '1' });
      const headerToken = signToken({ sub: 'desde-header', role: 'internal_operator', internalUserId: '2' });
      const { context, request, reflector } = buildContext({
        cookie: `atlas_internal_access=${cookieToken}`,
        authorization: `Bearer ${headerToken}`,
      });
      const guard = new JwtAuthGuard(reflector, buildRevocationServiceMock(null));

      await guard.canActivate(context);

      expect(request.user?.sub).toBe('desde-cookie');
    });

    it('encuentra la cookie de acceso entre otras cookies', async () => {
      const token = signToken({ sub: 'int-1', role: 'internal_operator', internalUserId: '1' });
      const { context, request, reflector } = buildContext({
        cookie: `otra=1; atlas_internal_access=${token}; atlas_internal_refresh=xyz`,
      });
      const guard = new JwtAuthGuard(reflector, buildRevocationServiceMock(null));

      await guard.canActivate(context);

      expect(request.user?.sub).toBe('int-1');
    });

    it('cae al header Authorization si la cookie no está (clientes no navegador)', async () => {
      const token = signToken({ sub: 'script-1', role: 'system', platformUserId: '9' });
      const { context, request, reflector } = buildContext({
        cookie: 'otra=1',
        authorization: `Bearer ${token}`,
      });
      const guard = new JwtAuthGuard(reflector, buildRevocationServiceMock(null));

      await guard.canActivate(context);

      expect(request.user?.sub).toBe('script-1');
    });

    it('rechaza un token de cookie con firma inválida', async () => {
      const badToken = jwt.sign({ sub: '1', role: 'customer' }, 'clave-incorrecta', { algorithm: 'HS256' });
      const { context, reflector } = buildContext({ cookie: `atlas_internal_access=${badToken}` });
      const guard = new JwtAuthGuard(reflector, buildRevocationServiceMock(null));

      await expect(guard.canActivate(context)).rejects.toThrow('Token inválido o expirado');
    });
  });

  it('rechaza si el esquema no es "Bearer"', async () => {
    const { context, reflector } = buildContext({ authorization: `Basic ${signToken({ sub: '1', role: 'customer' })}` });
    const guard = new JwtAuthGuard(reflector, buildRevocationServiceMock(null));

    await expect(guard.canActivate(context)).rejects.toThrow('Formato de Authorization inválido');
  });

  it('rechaza un token con firma inválida', async () => {
    const badToken = jwt.sign({ sub: '1', role: 'customer' }, 'clave-incorrecta', { algorithm: 'HS256' });
    const { context, reflector } = buildContext({ authorization: `Bearer ${badToken}` });
    const guard = new JwtAuthGuard(reflector, buildRevocationServiceMock(null));

    await expect(guard.canActivate(context)).rejects.toThrow('Token inválido o expirado');
  });

  it('acepta un token válido sin tokenVersion (compatibilidad con dev-jwt) y no consulta revocación', async () => {
    const token = signToken({ sub: 'cust-1', role: 'customer', customerId: '1' });
    const { context, request, reflector } = buildContext({ authorization: `Bearer ${token}` });
    const revocationService = buildRevocationServiceMock(null);
    const guard = new JwtAuthGuard(reflector, revocationService);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user?.sub).toBe('cust-1');
    expect(revocationService.getCurrentTokenVersion).not.toHaveBeenCalled();
  });

  it('acepta un token con tokenVersion vigente (coincide con TokenRevocationService)', async () => {
    const token = signToken({ sub: 'cust-1', role: 'customer', customerId: '1', tokenVersion: 3 });
    const { context, reflector } = buildContext({ authorization: `Bearer ${token}` });
    const revocationService = buildRevocationServiceMock(3);
    const guard = new JwtAuthGuard(reflector, revocationService);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(revocationService.getCurrentTokenVersion).toHaveBeenCalledWith('customer', '1');
  });

  it('rechaza un token con tokenVersion desactualizado (revocado por cambio de contraseña/logout)', async () => {
    const token = signToken({ sub: 'cust-1', role: 'customer', customerId: '1', tokenVersion: 2 });
    const { context, reflector } = buildContext({ authorization: `Bearer ${token}` });
    const revocationService = buildRevocationServiceMock(3); // versión vigente ya avanzó a 3

    const guard = new JwtAuthGuard(reflector, revocationService);

    await expect(guard.canActivate(context)).rejects.toThrow('Token revocado');
  });
});
