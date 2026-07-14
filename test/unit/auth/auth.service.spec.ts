import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException, ForbiddenException, ConflictException } from '@nestjs/common';

// Se mockean las utilidades criptográficas para aislar la lógica de negocio de `AuthService`
// de la librería `argon2` (no instalable en el sandbox donde se escribió este patch por falta
// de acceso a red, ver IMPLEMENTATION_REPORT.md). El comportamiento de argon2 en sí mismo ya
// está cubierto por `password.util.spec.ts`.
jest.mock('../../../src/common/utils/crypto/password.util.js', () => ({
  hashPassword: jest.fn(async (plain: string) => `hashed:${plain}`),
  verifyPassword: jest.fn(async (hash: string, plain: string) => hash === `hashed:${plain}`),
  isPasswordStrongEnough: jest.fn(() => true),
}));

jest.mock('../../../src/common/utils/crypto/refresh-token.util.js', () => ({
  generateRefreshToken: jest.fn(() => 'fixed-refresh-token'),
  hashRefreshToken: jest.fn((token: string) => `hash-of-${token}`),
}));

import { AuthService } from '../../../src/modules/auth/auth.service.js';

function buildAuthRepositoryMock() {
  return {
    findInternalUserByEmail: jest.fn(),
    findPlatformUserByEmail: jest.fn(),
    findInternalUserById: jest.fn(),
    findPlatformUserById: jest.fn(),
    findCredentialsByActor: jest.fn(),
    createCredentials: jest.fn(),
    recordFailedAttempt: jest.fn(),
    recordSuccessfulLogin: jest.fn(),
    createRefreshToken: jest.fn(async () => ({ id: 'refresh-row-1' })),
    findActiveRefreshTokenByHash: jest.fn(),
    revokeRefreshToken: jest.fn(),
    revokeAllRefreshTokensForActor: jest.fn(),
    recordLoginAttemptEvent: jest.fn(),
  };
}

function buildCustomersRepositoryMock() {
  return {
    findByContactHash: jest.fn(),
    findById: jest.fn(),
  };
}

function buildTokenRevocationServiceMock() {
  return {
    getCurrentTokenVersion: jest.fn(),
    bumpTokenVersion: jest.fn(),
  };
}

describe('AuthService.login', () => {
  it('throws UnauthorizedException with a generic message when the actor does not exist', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    customersRepository.findByContactHash.mockResolvedValue(null);

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(
      service.login({
        tenantId: '1',
        dto: { actorType: 'customer', identifier: 'nadie@atlas.test', password: 'x' },
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ successful: false, failureReasonCode: 'actor_not_found', actorId: null }),
    );
  });

  it('throws UnauthorizedException when the password does not match, and records a failed attempt', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    customersRepository.findByContactHash.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:correct-password',
      tokenVersion: 1,
      lockedUntil: null,
      failedLoginAttempts: 0,
    });

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(
      service.login({
        tenantId: '1',
        dto: { actorType: 'customer', identifier: '70000000', password: 'wrong-password' },
        ip: '127.0.0.1',
        userAgent: 'jest',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(authRepository.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ successful: false, failureReasonCode: 'invalid_password', actorId: '10' }),
    );
  });

  it('rejects login while the account is locked, without checking the password', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    customersRepository.findByContactHash.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:correct-password',
      tokenVersion: 1,
      lockedUntil: new Date(Date.now() + 60_000),
      failedLoginAttempts: 5,
    });

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(
      service.login({
        tenantId: '1',
        dto: { actorType: 'customer', identifier: '70000000', password: 'correct-password' },
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(authRepository.recordFailedAttempt).not.toHaveBeenCalled();
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ successful: false, failureReasonCode: 'account_locked', actorId: '10' }),
    );
  });

  it('returns an access+refresh token pair on successful login and records the successful login', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    customersRepository.findByContactHash.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:correct-password',
      tokenVersion: 3,
      lockedUntil: null,
      failedLoginAttempts: 0,
    });

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    const result = await service.login({
      tenantId: '1',
      dto: { actorType: 'customer', identifier: '70000000', password: 'correct-password' },
      ip: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(result.tokenType).toBe('Bearer');
    expect(typeof result.accessToken).toBe('string');
    expect(result.refreshToken).toBe('fixed-refresh-token');
    expect(authRepository.recordSuccessfulLogin).toHaveBeenCalledTimes(1);
    expect(authRepository.createRefreshToken).toHaveBeenCalledTimes(1);
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ successful: true, failureReasonCode: null, actorId: '10', eventType: 'login' }),
    );
  });

  it('does not authenticate a customer whose lifecycleStatus is closed', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    customersRepository.findByContactHash.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'closed' });

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(
      service.login({
        tenantId: '1',
        dto: { actorType: 'customer', identifier: '70000000', password: 'whatever' },
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(authRepository.findCredentialsByActor).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rejects an unknown or already-revoked refresh token', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue(null);

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(service.refresh({ refreshToken: 'stale-token', ip: null, userAgent: null })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired refresh token', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
      actorType: 'customer',
      actorId: '10',
      tenantId: '1',
    });

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(service.refresh({ refreshToken: 'expired-token', ip: null, userAgent: null })).rejects.toThrow(UnauthorizedException);
  });

  it('rotates the refresh token: revokes the old one and issues a new access+refresh pair', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const storedToken = {
      expiresAt: new Date(Date.now() + 60_000),
      actorType: 'customer',
      actorId: '10',
      tenantId: '1',
    };
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue(storedToken);
    authRepository.findCredentialsByActor.mockResolvedValue({ tokenVersion: 2 });
    customersRepository.findById.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    const result = await service.refresh({ refreshToken: 'valid-token', ip: null, userAgent: null });

    expect(authRepository.revokeRefreshToken).toHaveBeenCalledWith(storedToken, 'rotated', 'refresh-row-1');
    expect(authRepository.createRefreshToken).toHaveBeenCalledTimes(1);
    expect(result.refreshToken).toBe('fixed-refresh-token');
  });

  it('does not create a new refresh token when the actor is no longer active', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      actorType: 'customer',
      actorId: '10',
      tenantId: '1',
    });
    authRepository.findCredentialsByActor.mockResolvedValue({ tokenVersion: 2 });
    customersRepository.findById.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'closed' });

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(service.refresh({ refreshToken: 'valid-token', ip: null, userAgent: null })).rejects.toThrow(UnauthorizedException);

    expect(authRepository.createRefreshToken).not.toHaveBeenCalled();
    expect(authRepository.revokeRefreshToken).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout', () => {
  it('is idempotent: logging out with an unknown token does not throw', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue(null);

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);
    await expect(service.logout({ refreshToken: 'unknown', allDevices: false })).resolves.toEqual({ loggedOut: true });
  });

  it('revokes only the given token when allDevices=false', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const storedToken = { actorType: 'customer', actorId: '10', tenantId: '1' };
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue(storedToken);

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);
    await service.logout({ refreshToken: 'token', allDevices: false });

    expect(authRepository.revokeRefreshToken).toHaveBeenCalledWith(storedToken, 'logout');
    expect(authRepository.revokeAllRefreshTokensForActor).not.toHaveBeenCalled();
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'logout', actorType: 'customer', actorId: '10', tenantId: '1', successful: true }),
    );
  });

  it('revokes all refresh tokens AND bumps tokenVersion when allDevices=true (closes ATLAS-AUDIT-026)', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const storedToken = { actorType: 'customer', actorId: '10' };
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue(storedToken);
    const credential = { tokenVersion: 1, actorType: 'customer', actorId: '10' };
    authRepository.findCredentialsByActor.mockResolvedValue(credential);

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);
    await service.logout({ refreshToken: 'token', allDevices: true });

    expect(authRepository.revokeAllRefreshTokensForActor).toHaveBeenCalledWith('customer', '10', 'logout_all_devices');
    expect(tokenRevocationService.bumpTokenVersion).toHaveBeenCalledWith('customer', '10');
  });
});

describe('AuthService.provisionCredentials', () => {
  it('rejects a requester who is not admin/platform_admin', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(
      service.provisionCredentials({ actorType: 'internal_user', actorId: '5', password: 'AtlasBnpl2026' }, { role: 'internal_operator' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects provisioning credentials twice for the same actor', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findInternalUserById.mockResolvedValue({ id: '5', tenantId: '1' });
    authRepository.findCredentialsByActor.mockResolvedValue({ id: '1' });

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    await expect(
      service.provisionCredentials({ actorType: 'internal_user', actorId: '5', password: 'AtlasBnpl2026' }, { role: 'admin' }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates credentials for a valid, not-yet-provisioned internal user', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findInternalUserById.mockResolvedValue({ id: '5', tenantId: '1' });
    authRepository.findCredentialsByActor.mockResolvedValue(null);

    const service = new AuthService(authRepository as never, customersRepository as never, tokenRevocationService as never);

    const result = await service.provisionCredentials(
      { actorType: 'internal_user', actorId: '5', password: 'AtlasBnpl2026' },
      { role: 'platform_admin' },
    );

    expect(result).toEqual({ provisioned: true });
    expect(authRepository.createCredentials).toHaveBeenCalledTimes(1);
  });
});
