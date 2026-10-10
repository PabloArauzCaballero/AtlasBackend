/**
 * @file Tope absoluto de la sesión del cliente: 8 h desde el último inicio de sesión con credenciales.
 * @business La app se renueva sola cada pocos minutos, pero ninguna sesión del cliente vive más que el tope; pasado,
 *   hay que volver a poner la contraseña o el PIN. Internos y comercio no cambian.
 * @system `AuthService.refresh` y `AuthTokenIssuerService` reales con repositorio doble.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { env } from '../../../src/config/env.js';
import { AuthService } from '../../../src/modules/auth/auth.service.js';
import { AuthTokenIssuerService } from '../../../src/modules/auth/auth-token-issuer.service.js';
import type { ResolvedActor } from '../../../src/modules/auth/auth-actor-resolver.service.js';
import {
  accessTokenTtlSeconds,
  customerSessionDeadline,
  describeTtl,
  isCustomerSessionExpired,
  refreshTokenExpiry,
  sessionStartOf,
} from '../../../src/modules/auth/customer-session-lifetime.js';

const HOUR = 60 * 60 * 1000;
const CAP_MS = env.AUTH_CUSTOMER_SESSION_ABSOLUTE_MAX_HOURS * HOUR;

type StoredToken = {
  id: string;
  actorType: string;
  actorId: string;
  tenantId: string | null;
  issuedAt?: Date;
  sessionStartedAt?: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
};

function build(stored: StoredToken) {
  const authRepository = {
    findRefreshTokenForUpdate: jest.fn(async (..._args: unknown[]) => stored),
    findCredentialsByActor: jest.fn(async (..._args: unknown[]) => ({ tokenVersion: 4 })),
    createRefreshToken: jest.fn(async (..._args: unknown[]) => ({ id: 'rt-new' })),
    revokeRefreshToken: jest.fn(async (..._args: unknown[]) => undefined),
    revokeDescendantChain: jest.fn(async (..._args: unknown[]) => []),
    recordRefreshReuseEvent: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const actorResolver = {
    reResolveActorRole: jest.fn(async (..._args: unknown[]) => ({
      id: stored.actorId,
      tenantId: stored.tenantId,
      role: stored.actorType === 'customer' ? 'customer' : 'admin',
      email: null,
      displayName: null,
    })),
  };
  const tokenIssuer = new AuthTokenIssuerService(authRepository as never);
  const tokenRevocation = { bumpTokenVersion: jest.fn(async (..._args: unknown[]) => undefined) };
  const sequelize = { transaction: jest.fn((work: (transaction: unknown) => unknown) => work({})) };
  const service = new AuthService(
    authRepository as never,
    actorResolver as never,
    {} as never,
    {} as never,
    tokenIssuer,
    tokenRevocation as never,
    {} as never,
    sequelize as never,
  );
  return { service, authRepository, tokenIssuer };
}

function customerToken(overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    id: 'rt-1',
    actorType: 'customer',
    actorId: '10',
    tenantId: '1',
    issuedAt: new Date(Date.now() - 10 * 60 * 1000),
    sessionStartedAt: new Date(Date.now() - 2 * HOUR),
    expiresAt: new Date(Date.now() + HOUR),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

function claims(accessToken: string) {
  return jwt.verify(accessToken, env.JWT_ACCESS_TOKEN_SECRET) as { iat: number; exp: number };
}

function createdRefreshToken(authRepository: ReturnType<typeof build>['authRepository']) {
  return authRepository.createRefreshToken.mock.calls[0]?.[0] as { sessionStartedAt: Date; expiresAt: Date };
}

async function refreshError(service: AuthService): Promise<UnauthorizedException> {
  try {
    await service.refresh({ refreshToken: 't', ip: null, userAgent: null });
  } catch (error) {
    return error as UnauthorizedException;
  }
  throw new Error('se esperaba un 401');
}

describe('Sesión del cliente: tope absoluto desde el inicio de sesión', () => {
  it('dentro del tope: rota y el token nuevo CONSERVA el inicio de la sesión (rotar no reinicia el reloj)', async () => {
    const startedAt = new Date(Date.now() - (CAP_MS - HOUR));
    const { service, authRepository } = build(customerToken({ sessionStartedAt: startedAt }));

    const result = await service.refresh({ refreshToken: 't', ip: null, userAgent: null });

    expect(result.refreshToken).toEqual(expect.any(String));
    const created = createdRefreshToken(authRepository);
    expect(created.sessionStartedAt).toEqual(startedAt);
    // El refresh token nuevo tampoco vive más allá del tope.
    expect(created.expiresAt.getTime()).toBeLessThanOrEqual(customerSessionDeadline(startedAt).getTime());
    expect(authRepository.revokeRefreshToken).toHaveBeenCalledWith(expect.anything(), 'rotated', 'rt-new', expect.anything());
  });

  it('fuera del tope: 401 SESSION_EXPIRED, revoca la sesión y no emite nada', async () => {
    const stored = customerToken({ sessionStartedAt: new Date(Date.now() - CAP_MS - 1000) });
    const { service, authRepository } = build(stored);

    const error = await refreshError(service);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(authRepository.revokeRefreshToken).toHaveBeenCalledWith(stored, 'session_expired', undefined, expect.anything());
    expect(authRepository.createRefreshToken).not.toHaveBeenCalled();
  });

  it('cerca del tope: el token de acceso vence con la sesión, no 15 min después', async () => {
    const startedAt = new Date(Date.now() - CAP_MS + 5 * 60 * 1000);
    const { service } = build(customerToken({ sessionStartedAt: startedAt }));

    const result = await service.refresh({ refreshToken: 't', ip: null, userAgent: null });

    const { exp } = claims(result.accessToken);
    expect(exp * 1000).toBeLessThanOrEqual(customerSessionDeadline(startedAt).getTime() + 1000);
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(5 * 60);
  });

  describe('tokens emitidos antes del cambio (sin inicio de sesión guardado)', () => {
    it('se cuentan desde su propia emisión: uno emitido hace más del tope ya no se renueva', async () => {
      const { service } = build(customerToken({ sessionStartedAt: null, issuedAt: new Date(Date.now() - CAP_MS - HOUR) }));
      expect((await refreshError(service)).getResponse()).toMatchObject({ code: 'SESSION_EXPIRED' });
    });

    it('uno reciente se renueva y el nuevo hereda esa emisión como inicio', async () => {
      const issuedAt = new Date(Date.now() - HOUR);
      const { service, authRepository } = build(customerToken({ sessionStartedAt: null, issuedAt }));

      await service.refresh({ refreshToken: 't', ip: null, userAgent: null });

      expect(createdRefreshToken(authRepository).sessionStartedAt).toEqual(issuedAt);
    });
  });

  it('sólo el cliente: un interno con sesión de dos días sigue rotando y con su vida de acceso de siempre', async () => {
    const { service } = build(
      customerToken({
        actorType: 'internal_user',
        sessionStartedAt: new Date(Date.now() - 48 * HOUR),
        expiresAt: new Date(Date.now() + HOUR),
      }),
    );

    const result = await service.refresh({ refreshToken: 't', ip: null, userAgent: null, expectedActorType: 'internal_user' });

    expect(result.expiresIn).toBe(env.JWT_ACCESS_TOKEN_EXPIRES_IN);
  });
});

describe('Inicio de sesión con credenciales: reinicia el reloj', () => {
  const actor: ResolvedActor = { id: '10', tenantId: '1', role: 'customer', email: null, displayName: null };

  it('un login nuevo abre la sesión AHORA, con acceso de 15 min y refresh token que vence con el tope', async () => {
    const { tokenIssuer, authRepository } = build(customerToken());
    const before = Date.now();

    const result = await tokenIssuer.issueTokenPair(actor, 'customer', 4, { ip: null, userAgent: null });

    const created = createdRefreshToken(authRepository);
    expect(created.sessionStartedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(created.expiresAt.getTime()).toBe(customerSessionDeadline(created.sessionStartedAt).getTime());
    const { iat, exp } = claims(result.accessToken);
    expect(exp - iat).toBe(env.AUTH_CUSTOMER_ACCESS_TOKEN_TTL_MINUTES * 60);
    expect(result.expiresIn).toBe(`${String(env.AUTH_CUSTOMER_ACCESS_TOKEN_TTL_MINUTES)}m`);
  });

  it('un interno que inicia sesión conserva la vida de acceso y de refresco de siempre', async () => {
    const { tokenIssuer, authRepository } = build(customerToken());

    const result = await tokenIssuer.issueTokenPair({ ...actor, role: 'admin' as const }, 'internal_user', 1, {
      ip: null,
      userAgent: null,
    });

    expect(result.expiresIn).toBe(env.JWT_ACCESS_TOKEN_EXPIRES_IN);
    const created = createdRefreshToken(authRepository);
    expect(created.expiresAt.getTime() - created.sessionStartedAt.getTime()).toBeGreaterThan(CAP_MS);
  });
});

describe('customer-session-lifetime', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it('el tope se cumple justo a las N horas', () => {
    const startedAt = new Date(now.getTime() - CAP_MS);
    expect(isCustomerSessionExpired(startedAt, now)).toBe(true);
    expect(isCustomerSessionExpired(new Date(startedAt.getTime() + 1), now)).toBe(false);
  });

  it('el inicio sale del token, de su emisión o, sin nada, de ahora', () => {
    const a = new Date('2026-10-10T01:00:00Z');
    const b = new Date('2026-10-10T02:00:00Z');
    expect(sessionStartOf({ sessionStartedAt: a, issuedAt: b }, now)).toBe(a);
    expect(sessionStartOf({ sessionStartedAt: null, issuedAt: b }, now)).toBe(b);
    expect(sessionStartOf({}, now)).toBe(now);
  });

  it('el refresh token de un comercio vence a los días de siempre', () => {
    const expiry = refreshTokenExpiry('merchant_user', now, now);
    expect(expiry.getTime() - now.getTime()).toBe(env.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * HOUR);
  });

  it('la vida del acceso: nula para no clientes, recortada al tope y nunca por debajo de 1 s', () => {
    expect(accessTokenTtlSeconds('internal_user', now, now)).toBeNull();
    expect(accessTokenTtlSeconds('customer', null, now)).toBe(env.AUTH_CUSTOMER_ACCESS_TOKEN_TTL_MINUTES * 60);
    expect(accessTokenTtlSeconds('customer', new Date(now.getTime() - CAP_MS + 90_000), now)).toBe(90);
    expect(accessTokenTtlSeconds('customer', new Date(now.getTime() - CAP_MS - 1000), now)).toBe(1);
  });

  it('expiresIn en minutos cuando es redondo, en segundos si no', () => {
    expect(describeTtl(900)).toBe('15m');
    expect(describeTtl(90)).toBe('90s');
    expect(describeTtl(null)).toBe(env.JWT_ACCESS_TOKEN_EXPIRES_IN);
  });
});
