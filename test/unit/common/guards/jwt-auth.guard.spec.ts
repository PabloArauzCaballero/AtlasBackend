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
 * autenticación de TODO el backend (salvo endpoints @Public) y desde ATLAS-AUDIT-026 incluye la
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
