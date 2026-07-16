import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException, ForbiddenException, ConflictException } from '@nestjs/common';

// Se mockean las utilidades criptográficas para aislar la lógica de negocio de `AuthService`.
// El comportamiento de argon2 está cubierto por `password.util.spec.ts`.
jest.mock('../../../src/common/utils/crypto/password.util.js', () => ({
  hashPassword: jest.fn(async (plain: string) => `hashed:${plain}`),
  verifyPassword: jest.fn(async (hash: string, plain: string) => hash === `hashed:${plain}`),
  isPasswordStrongEnough: jest.fn(() => true),
}));

jest.mock('../../../src/common/utils/crypto/refresh-token.util.js', () => ({
  generateRefreshToken: jest.fn(() => 'fixed-refresh-token'),
  hashRefreshToken: jest.fn((token: string) => `hash-of-${token}`),
}));

import { AuthService, isLoginPinChallenge, LoginOutcome } from '../../../src/modules/auth/auth.service.js';

function buildAuthRepositoryMock() {
  return {
    findInternalUserByEmail: jest.fn(),
    findPlatformUserByEmail: jest.fn(),
    findInternalUserById: jest.fn(),
    findPlatformUserById: jest.fn(),
    findCredentialsByActor: jest.fn(),
    createCredentials: jest.fn(),
    updatePasswordHash: jest.fn(),
    createOneTimeCode: jest.fn(),
    findActiveOneTimeCodeByActor: jest.fn(),
    findActiveOneTimeCodeByChallenge: jest.fn(),
    registerOneTimeCodeFailedAttempt: jest.fn(),
    consumeOneTimeCode: jest.fn(),
    recordFailedAttempt: jest.fn(),
    recordSuccessfulLogin: jest.fn(),
    createRefreshToken: jest.fn(async () => ({ id: 'refresh-row-1' })),
    findActiveRefreshTokenByHash: jest.fn(),
    findRefreshTokenForUpdate: jest.fn(),
    revokeRefreshToken: jest.fn(),
    revokeAllRefreshTokensForActor: jest.fn(),
    revokeDescendantChain: jest.fn(async () => []),
    recordRefreshReuseEvent: jest.fn(),
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

// Por defecto sin correo configurado: `isLoginPinRequired()` corta antes de llegar a
// `sendLoginPin`/`sendPasswordResetCode`, así que los tests existentes (que no ejercitan el
// flujo de PIN/reset) siguen recibiendo un `LoginResult` plano, igual que antes de que existiera.
function buildMailSenderServiceMock() {
  return {
    isEnabled: jest.fn(() => false),
    sendLoginPin: jest.fn(),
    sendPasswordResetCode: jest.fn(),
    sendInitialCredentials: jest.fn(),
  };
}

// `AuthService.refresh` corre dentro de `sequelize.transaction(callback)`. Para la mayoría de los
// tests, el mock ejecuta el callback de inmediato con una transacción falsa, sin abrir ninguna
// conexión real. Para el test de concurrencia, en cambio, encola cada llamada detrás de la
// anterior — así reproduce la semántica real de `SELECT ... FOR UPDATE`: una segunda transacción
// que compite por la misma fila espera a que la primera haga commit antes de poder leerla, en vez
// de correr ambas en paralelo sobre datos ya obsoletos.
function buildSequelizeMock() {
  let queue: Promise<unknown> = Promise.resolve();
  const transaction = jest.fn((work: (transaction: unknown) => unknown) => {
    const run = queue.then(() => work({}));
    queue = run.catch(() => undefined);
    return run;
  });
  return { transaction };
}

function buildService(
  authRepository: ReturnType<typeof buildAuthRepositoryMock>,
  customersRepository: ReturnType<typeof buildCustomersRepositoryMock>,
  tokenRevocationService: ReturnType<typeof buildTokenRevocationServiceMock>,
  mailSenderService: ReturnType<typeof buildMailSenderServiceMock> = buildMailSenderServiceMock(),
  sequelize: ReturnType<typeof buildSequelizeMock> = buildSequelizeMock(),
) {
  return new AuthService(
    authRepository as never,
    customersRepository as never,
    tokenRevocationService as never,
    mailSenderService as never,
    sequelize as never,
  );
}

// El login exitoso ahora retorna `LoginOutcome` (`LoginResult | LoginPinChallenge`). Los tests que
// esperan un login de un solo paso (todos los de este archivo usan `customer`, que nunca exige
// PIN) usan este helper para angostar el tipo y fallar con un mensaje claro si algún día un test
// termina ejercitando sin querer la rama de desafío.
function expectLoginResult(outcome: LoginOutcome) {
  if (isLoginPinChallenge(outcome)) throw new Error('expected a plain LoginResult, got a LoginPinChallenge');
  return outcome;
}

describe('AuthService.login', () => {
  it('throws UnauthorizedException with a generic message when the actor does not exist', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    customersRepository.findByContactHash.mockResolvedValue(null);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

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

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

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

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

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

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    const result = expectLoginResult(
      await service.login({
        tenantId: '1',
        dto: { actorType: 'customer', identifier: '70000000', password: 'correct-password' },
        ip: '127.0.0.1',
        userAgent: 'jest',
      }),
    );

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

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

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
  it('rejects an unknown refresh token', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findRefreshTokenForUpdate.mockResolvedValue(null);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(service.refresh({ refreshToken: 'stale-token', ip: null, userAgent: null })).rejects.toThrow(UnauthorizedException);
    expect(authRepository.createRefreshToken).not.toHaveBeenCalled();
  });

  it('rejects an expired refresh token', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findRefreshTokenForUpdate.mockResolvedValue({
      id: 'rt-1',
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      revokedReason: null,
      actorType: 'customer',
      actorId: '10',
      tenantId: '1',
    });

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(service.refresh({ refreshToken: 'expired-token', ip: null, userAgent: null })).rejects.toThrow(UnauthorizedException);
    expect(authRepository.createRefreshToken).not.toHaveBeenCalled();
  });

  it('rejects a token revoked by logout (not by rotation) without treating it as reuse', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findRefreshTokenForUpdate.mockResolvedValue({
      id: 'rt-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      revokedReason: 'logout',
      actorType: 'customer',
      actorId: '10',
      tenantId: '1',
    });

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(service.refresh({ refreshToken: 'logged-out-token', ip: null, userAgent: null })).rejects.toThrow(UnauthorizedException);
    expect(authRepository.revokeDescendantChain).not.toHaveBeenCalled();
    expect(tokenRevocationService.bumpTokenVersion).not.toHaveBeenCalled();
  });

  it('rotates the refresh token: revokes the old one and issues a new access+refresh pair', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const storedToken = {
      id: 'rt-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      revokedReason: null,
      actorType: 'customer',
      actorId: '10',
      tenantId: '1',
    };
    authRepository.findRefreshTokenForUpdate.mockResolvedValue(storedToken);
    authRepository.findCredentialsByActor.mockResolvedValue({ tokenVersion: 2 });
    customersRepository.findById.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    const result = await service.refresh({ refreshToken: 'valid-token', ip: null, userAgent: null });

    expect(authRepository.revokeRefreshToken).toHaveBeenCalledWith(storedToken, 'rotated', 'refresh-row-1', expect.anything());
    expect(authRepository.createRefreshToken).toHaveBeenCalledTimes(1);
    expect(result.refreshToken).toBe('fixed-refresh-token');
  });

  it('does not create a new refresh token when the actor is no longer active', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findRefreshTokenForUpdate.mockResolvedValue({
      id: 'rt-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      revokedReason: null,
      actorType: 'customer',
      actorId: '10',
      tenantId: '1',
    });
    authRepository.findCredentialsByActor.mockResolvedValue({ tokenVersion: 2 });
    customersRepository.findById.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'closed' });

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(service.refresh({ refreshToken: 'valid-token', ip: null, userAgent: null })).rejects.toThrow(UnauthorizedException);

    expect(authRepository.createRefreshToken).not.toHaveBeenCalled();
    expect(authRepository.revokeRefreshToken).not.toHaveBeenCalled();
  });

  describe('reuse detection', () => {
    it('when a token already rotated is presented again, revokes the descendant chain, bumps tokenVersion, and rejects', async () => {
      const authRepository = buildAuthRepositoryMock();
      const customersRepository = buildCustomersRepositoryMock();
      const tokenRevocationService = buildTokenRevocationServiceMock();
      authRepository.findRefreshTokenForUpdate.mockResolvedValue({
        id: 'rt-1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
        revokedReason: 'rotated',
        actorType: 'customer',
        actorId: '10',
        tenantId: '1',
      });
      authRepository.revokeDescendantChain.mockResolvedValue(['rt-2', 'rt-3']);

      const service = buildService(authRepository, customersRepository, tokenRevocationService);

      await expect(service.refresh({ refreshToken: 'reused-token', ip: null, userAgent: null })).rejects.toThrow(UnauthorizedException);

      expect(authRepository.revokeDescendantChain).toHaveBeenCalledWith('rt-1', expect.anything());
      expect(authRepository.recordRefreshReuseEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'customer', actorId: '10', reusedTokenId: 'rt-1', revokedDescendantIds: ['rt-2', 'rt-3'] }),
        expect.anything(),
      );
      expect(tokenRevocationService.bumpTokenVersion).toHaveBeenCalledWith('customer', '10');
      expect(authRepository.createRefreshToken).not.toHaveBeenCalled();
    });

    it('the reuse revocation is not undone by the request itself failing (writes happen before the throw)', async () => {
      // Regresión específica del diseño: si la excepción se lanzara DENTRO del callback de
      // `sequelize.transaction`, Sequelize haría rollback y la revocación de la cadena de
      // descendientes nunca llegaría a persistirse. Este test fija que `revokeDescendantChain` y
      // `recordRefreshReuseEvent` se llaman ANTES de que `refresh()` lance la excepción.
      const authRepository = buildAuthRepositoryMock();
      const customersRepository = buildCustomersRepositoryMock();
      const tokenRevocationService = buildTokenRevocationServiceMock();
      authRepository.findRefreshTokenForUpdate.mockResolvedValue({
        id: 'rt-1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
        revokedReason: 'rotated',
        actorType: 'internal_user',
        actorId: '5',
        tenantId: '1',
      });

      const callOrder: string[] = [];
      authRepository.revokeDescendantChain.mockImplementation(async () => {
        callOrder.push('revokeDescendantChain');
        return [];
      });
      authRepository.recordRefreshReuseEvent.mockImplementation(async () => {
        callOrder.push('recordRefreshReuseEvent');
      });

      const service = buildService(authRepository, customersRepository, tokenRevocationService);

      try {
        await service.refresh({ refreshToken: 'reused-token', ip: null, userAgent: null });
        throw new Error('expected refresh() to throw');
      } catch (error) {
        callOrder.push('threw');
        expect(error).toBeInstanceOf(UnauthorizedException);
      }

      expect(callOrder).toEqual(['revokeDescendantChain', 'recordRefreshReuseEvent', 'threw']);
    });
  });

  it('locks the token row for the duration of the rotation: two concurrent refreshes never both rotate the same token', async () => {
    // Simula la semántica de `SELECT ... FOR UPDATE`: la primera llamada a
    // `findRefreshTokenForUpdate` ve el token activo; para cuando la "segunda" solicitud
    // (concurrente) adquiere el lock, ya ve el token revocado por la primera — exactamente el
    // comportamiento que produce Postgres cuando dos transacciones compiten por la misma fila.
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();

    const activeToken = {
      id: 'rt-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null as Date | null,
      revokedReason: null as string | null,
      actorType: 'customer',
      actorId: '10',
      tenantId: '1',
    };

    authRepository.findRefreshTokenForUpdate.mockImplementation(async () => ({ ...activeToken }));
    authRepository.findCredentialsByActor.mockResolvedValue({ tokenVersion: 2 });
    customersRepository.findById.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });
    authRepository.revokeRefreshToken.mockImplementation(async () => {
      activeToken.revokedAt = new Date();
      activeToken.revokedReason = 'rotated';
    });

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    const [first, second] = await Promise.allSettled([
      service.refresh({ refreshToken: 'shared-token', ip: null, userAgent: null }),
      service.refresh({ refreshToken: 'shared-token', ip: null, userAgent: null }),
    ]);

    const settled = [first, second];
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(authRepository.createRefreshToken).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.logout', () => {
  it('is idempotent: logging out with an unknown token does not throw', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue(null);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);
    await expect(service.logout({ refreshToken: 'unknown', allDevices: false })).resolves.toEqual({ loggedOut: true });
  });

  it('revokes only the given token when allDevices=false', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const storedToken = { actorType: 'customer', actorId: '10', tenantId: '1' };
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue(storedToken);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);
    await service.logout({ refreshToken: 'token', allDevices: false });

    expect(authRepository.revokeRefreshToken).toHaveBeenCalledWith(storedToken, 'logout');
    expect(authRepository.revokeAllRefreshTokensForActor).not.toHaveBeenCalled();
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'logout', actorType: 'customer', actorId: '10', tenantId: '1', successful: true }),
    );
  });

  it('revokes all refresh tokens AND bumps tokenVersion when allDevices=true', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const storedToken = { actorType: 'customer', actorId: '10' };
    authRepository.findActiveRefreshTokenByHash.mockResolvedValue(storedToken);
    const credential = { tokenVersion: 1, actorType: 'customer', actorId: '10' };
    authRepository.findCredentialsByActor.mockResolvedValue(credential);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);
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
    const service = buildService(authRepository, customersRepository, tokenRevocationService);

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

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

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

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    const result = await service.provisionCredentials(
      { actorType: 'internal_user', actorId: '5', password: 'AtlasBnpl2026' },
      { role: 'platform_admin' },
    );

    expect(result).toEqual({ provisioned: true });
    expect(authRepository.createCredentials).toHaveBeenCalledTimes(1);
  });
});
