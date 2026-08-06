import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { UnauthorizedException, ForbiddenException, ConflictException, ServiceUnavailableException } from '@nestjs/common';

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
import { AuthActorResolverService } from '../../../src/modules/auth/auth-actor-resolver.service.js';
import { AuthPasswordResetService } from '../../../src/modules/auth/auth-password-reset.service.js';
import { AuthSecondFactorService } from '../../../src/modules/auth/auth-second-factor.service.js';
import { hashOneTimeCode } from '../../../src/common/utils/crypto/one-time-code.util.js';
import { env } from '../../../src/config/env.js';

function buildAuthRepositoryMock() {
  return {
    findInternalUserByEmail: asyncMock(),
    findPlatformUserByEmail: asyncMock(),
    findInternalUserById: asyncMock(),
    findPlatformUserById: asyncMock(),
    findCredentialsByActor: asyncMock(),
    createCredentials: asyncMock(),
    updatePasswordHash: asyncMock(),
    setMfaEnabled: asyncMock(),
    createOneTimeCode: asyncMock(),
    findActiveOneTimeCodeByActor: asyncMock(),
    findActiveOneTimeCodeByChallenge: asyncMock(),
    registerOneTimeCodeFailedAttempt: asyncMock(),
    consumeOneTimeCode: asyncMock(),
    recordFailedAttempt: asyncMock(),
    recordSuccessfulLogin: asyncMock(),
    createRefreshToken: jest.fn(async () => ({ id: 'refresh-row-1' })),
    findActiveRefreshTokenByHash: asyncMock(),
    findRefreshTokenForUpdate: asyncMock(),
    revokeRefreshToken: asyncMock(),
    revokeAllRefreshTokensForActor: asyncMock(),
    revokeDescendantChain: jest.fn(async (): Promise<string[]> => []),
    recordRefreshReuseEvent: asyncMock(),
    recordLoginAttemptEvent: asyncMock(),
  };
}

function buildCustomersRepositoryMock() {
  return {
    findContactMethods: jest.fn(async () => []),
    findByContactHash: asyncMock(),
    findById: asyncMock(),
  };
}

function buildTokenRevocationServiceMock() {
  return {
    getCurrentTokenVersion: asyncMock(),
    bumpTokenVersion: asyncMock(),
  };
}

// Por defecto sin correo configurado: `isLoginPinRequired()` corta antes de llegar a
// `sendLoginPin`/`sendPasswordResetCode`, así que los tests existentes (que no ejercitan el
// flujo de PIN/reset) siguen recibiendo un `LoginResult` plano, igual que antes de que existiera.
function buildMailSenderServiceMock() {
  return {
    isEnabled: jest.fn(() => false),
    sendLoginPin: asyncMock(),
    sendPasswordResetCode: asyncMock(),
    sendInitialCredentials: asyncMock(),
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
  metrics?: { recordAuthAttempt: jest.Mock },
) {
  // Los colaboradores extraídos (Fase 2.2) se construyen con los MISMOS mocks, de modo que los
  // tests públicos de `AuthService` ejercitan la resolución de actor y el reset reales, sin
  // duplicar mocks ni cambiar ninguna aserción.
  const actorResolver = new AuthActorResolverService(authRepository as never, customersRepository as never);
  const passwordReset = new AuthPasswordResetService(
    authRepository as never,
    tokenRevocationService as never,
    mailSenderService as never,
    actorResolver,
  );
  const secondFactor = new AuthSecondFactorService(authRepository as never, actorResolver, mailSenderService as never);
  return new AuthService(
    authRepository as never,
    actorResolver,
    passwordReset,
    secondFactor,
    tokenRevocationService as never,
    mailSenderService as never,
    sequelize as never,
    metrics as never,
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

describe('AuthService.login — 2FA obligatorio para actores internos (Fase 4.2)', () => {
  function buildInternalLoginMocks() {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const mailSenderService = buildMailSenderServiceMock();
    authRepository.findInternalUserByEmail.mockResolvedValue({
      id: '99',
      tenantId: '1',
      status: 'active',
      roleCode: 'risk_analyst',
      email: 'ana@atlas.test',
      fullName: 'Ana',
    });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:correct-password',
      tokenVersion: 1,
      lockedUntil: null,
      failedLoginAttempts: 0,
    });
    return { authRepository, customersRepository, tokenRevocationService, mailSenderService };
  }

  it('exige el PIN de segundo factor a un internal_user cuando MailSender está configurado (no emite tokens todavía)', async () => {
    const m = buildInternalLoginMocks();
    m.mailSenderService.isEnabled.mockReturnValue(true);
    const service = buildService(m.authRepository, m.customersRepository, m.tokenRevocationService, m.mailSenderService);

    const outcome = await service.login({
      tenantId: '1',
      dto: { actorType: 'internal_user', identifier: 'ana@atlas.test', password: 'correct-password' },
      ip: null,
      userAgent: null,
    });

    expect(isLoginPinChallenge(outcome)).toBe(true);
    expect(m.mailSenderService.sendLoginPin).toHaveBeenCalledTimes(1);
    expect(m.authRepository.createOneTimeCode).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'login_pin', actorId: '99' }));
    // 2FA pendiente: aún NO se emiten tokens ni se marca el login como exitoso.
    expect(m.authRepository.createRefreshToken).not.toHaveBeenCalled();
    expect(m.authRepository.recordSuccessfulLogin).not.toHaveBeenCalled();
  });

  it('cae a login de un solo paso para un internal_user si NO hay MailSender (no puede entregar el PIN)', async () => {
    const m = buildInternalLoginMocks();
    m.mailSenderService.isEnabled.mockReturnValue(false);
    const service = buildService(m.authRepository, m.customersRepository, m.tokenRevocationService, m.mailSenderService);

    const result = expectLoginResult(
      await service.login({
        tenantId: '1',
        dto: { actorType: 'internal_user', identifier: 'ana@atlas.test', password: 'correct-password' },
        ip: null,
        userAgent: null,
      }),
    );

    expect(result.tokenType).toBe('Bearer');
    expect(m.mailSenderService.sendLoginPin).not.toHaveBeenCalled();
    expect(m.authRepository.createRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('NO exige segundo factor a un cliente aunque MailSender esté configurado (su MFA es un flujo aparte)', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const mailSenderService = buildMailSenderServiceMock();
    mailSenderService.isEnabled.mockReturnValue(true);
    customersRepository.findByContactHash.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:correct-password',
      tokenVersion: 1,
      lockedUntil: null,
      failedLoginAttempts: 0,
    });
    const service = buildService(authRepository, customersRepository, tokenRevocationService, mailSenderService);

    const result = expectLoginResult(
      await service.login({
        tenantId: '1',
        dto: { actorType: 'customer', identifier: '70000000', password: 'correct-password' },
        ip: null,
        userAgent: null,
      }),
    );

    expect(result.tokenType).toBe('Bearer');
    expect(mailSenderService.sendLoginPin).not.toHaveBeenCalled();
  });
});

describe('AuthService — MFA opt-in del cliente (Fase 4.2)', () => {
  it('un cliente CON mfaEnabled y correo configurado recibe el desafío OTP (login por email)', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const mailSenderService = buildMailSenderServiceMock();
    mailSenderService.isEnabled.mockReturnValue(true);
    // Login con email para que el OTP tenga destino (el email en claro solo existe si el cliente lo escribió).
    customersRepository.findByContactHash.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:correct-password',
      tokenVersion: 1,
      lockedUntil: null,
      failedLoginAttempts: 0,
      mfaEnabled: true,
    });
    const service = buildService(authRepository, customersRepository, tokenRevocationService, mailSenderService);

    const outcome = await service.login({
      tenantId: '1',
      dto: { actorType: 'customer', identifier: 'cliente@atlas.test', password: 'correct-password' },
      ip: null,
      userAgent: null,
    });

    expect(isLoginPinChallenge(outcome)).toBe(true);
    expect(mailSenderService.sendLoginPin).toHaveBeenCalledTimes(1);
    expect(authRepository.createRefreshToken).not.toHaveBeenCalled();
  });

  it('un cliente SIN mfaEnabled entra en un paso aunque haya correo configurado', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const mailSenderService = buildMailSenderServiceMock();
    mailSenderService.isEnabled.mockReturnValue(true);
    customersRepository.findByContactHash.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:correct-password',
      tokenVersion: 1,
      lockedUntil: null,
      failedLoginAttempts: 0,
      mfaEnabled: false,
    });
    const service = buildService(authRepository, customersRepository, tokenRevocationService, mailSenderService);

    const result = expectLoginResult(
      await service.login({
        tenantId: '1',
        dto: { actorType: 'customer', identifier: 'cliente@atlas.test', password: 'correct-password' },
        ip: null,
        userAgent: null,
      }),
    );
    expect(result.tokenType).toBe('Bearer');
    expect(mailSenderService.sendLoginPin).not.toHaveBeenCalled();
  });

  it('setCustomerMfaPreference activa el flag en la credencial del cliente', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const mailSenderService = buildMailSenderServiceMock();
    mailSenderService.isEnabled.mockReturnValue(true);
    const credential = { mfaEnabled: false };
    authRepository.findCredentialsByActor.mockResolvedValue(credential);
    const service = buildService(authRepository, customersRepository, tokenRevocationService, mailSenderService);

    const result = await service.setCustomerMfaPreference({ actorId: '10', enabled: true });

    expect(result).toEqual({ mfaEnabled: true });
    expect(authRepository.setMfaEnabled).toHaveBeenCalledWith(credential, true);
  });

  it('no permite activar MFA si no hay MailSender (evita bloquear al cliente en el próximo login)', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const mailSenderService = buildMailSenderServiceMock();
    mailSenderService.isEnabled.mockReturnValue(false);
    authRepository.findCredentialsByActor.mockResolvedValue({ mfaEnabled: false });
    const service = buildService(authRepository, customersRepository, tokenRevocationService, mailSenderService);

    await expect(service.setCustomerMfaPreference({ actorId: '10', enabled: true })).rejects.toThrow(ServiceUnavailableException);
    expect(authRepository.setMfaEnabled).not.toHaveBeenCalled();
  });

  it('permite DESactivar MFA aunque no haya MailSender', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const mailSenderService = buildMailSenderServiceMock();
    mailSenderService.isEnabled.mockReturnValue(false);
    const credential = { mfaEnabled: true };
    authRepository.findCredentialsByActor.mockResolvedValue(credential);
    const service = buildService(authRepository, customersRepository, tokenRevocationService, mailSenderService);

    const result = await service.setCustomerMfaPreference({ actorId: '10', enabled: false });
    expect(result).toEqual({ mfaEnabled: false });
    expect(authRepository.setMfaEnabled).toHaveBeenCalledWith(credential, false);
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
      service.provisionCredentials(
        { actorType: 'internal_user', actorId: '5', password: 'AtlasBnpl2026' },
        { role: 'internal_operator', tenantId: '1' },
      ),
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
      service.provisionCredentials(
        { actorType: 'internal_user', actorId: '5', password: 'AtlasBnpl2026' },
        { role: 'admin', tenantId: '1' },
      ),
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
      { role: 'platform_admin', tenantId: null },
    );

    expect(result).toEqual({ provisioned: true });
    expect(authRepository.createCredentials).toHaveBeenCalledTimes(1);
  });

  // ATLAS-SEC-007. La explotación real está en docs/audit/evidence/live-exploit-2026-08-06.md:
  // un `admin` del tenant 1 fijaba la contraseña de un `internal_user` del tenant 2 y entraba como
  // él. `TenantGuard` no puede cubrirlo porque el destino llega en el cuerpo, no en el header.
  it('un admin NO puede provisionar credenciales de un actor de otro tenant', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findInternalUserById.mockResolvedValue({ id: '3', tenantId: '2' });
    authRepository.findCredentialsByActor.mockResolvedValue(null);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(
      service.provisionCredentials(
        { actorType: 'internal_user', actorId: '3', password: 'AtlasBnpl2026' },
        { role: 'admin', tenantId: '1' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(authRepository.createCredentials).not.toHaveBeenCalled();
  });

  it('un admin SÍ puede provisionar dentro de su propio tenant', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findInternalUserById.mockResolvedValue({ id: '5', tenantId: '1' });
    authRepository.findCredentialsByActor.mockResolvedValue(null);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(
      service.provisionCredentials(
        { actorType: 'internal_user', actorId: '5', password: 'AtlasBnpl2026' },
        { role: 'admin', tenantId: '1' },
      ),
    ).resolves.toEqual({ provisioned: true });
  });

  it('un admin sin tenant en el token no puede provisionar nada', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findInternalUserById.mockResolvedValue({ id: '5', tenantId: '1' });
    authRepository.findCredentialsByActor.mockResolvedValue(null);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(
      service.provisionCredentials(
        { actorType: 'internal_user', actorId: '5', password: 'AtlasBnpl2026' },
        { role: 'admin', tenantId: null },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // Un platform_user no pertenece a ningún tenant: provisionarlo es un acto de alcance plataforma.
  it('un admin de tenant no puede provisionar un platform_user', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(
      service.provisionCredentials(
        { actorType: 'platform_user', actorId: '9', password: 'AtlasBnpl2026' },
        { role: 'admin', tenantId: '1' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(authRepository.findPlatformUserById).not.toHaveBeenCalled();
  });

  it('un platform_admin sí puede provisionar un platform_user', async () => {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    authRepository.findPlatformUserById.mockResolvedValue({ id: '9' });
    authRepository.findCredentialsByActor.mockResolvedValue(null);

    const service = buildService(authRepository, customersRepository, tokenRevocationService);

    await expect(
      service.provisionCredentials(
        { actorType: 'platform_user', actorId: '9', password: 'AtlasBnpl2026' },
        { role: 'platform_admin', tenantId: null },
      ),
    ).resolves.toEqual({ provisioned: true });
  });
});

describe('AuthService.verifyLoginPin (2FA por PIN de super admin / MFA cliente)', () => {
  const challenge = (over: Record<string, unknown> = {}) => ({
    purpose: 'login_pin',
    expiresAt: new Date(Date.now() + 60_000),
    actorType: 'internal_user',
    actorId: '5',
    tenantId: '1',
    codeHash: hashOneTimeCode('123456'),
    ...over,
  });
  const activeInternalUser = { id: '5', tenantId: '1', status: 'active', roleCode: 'internal_operator', email: 'a@x.com', fullName: 'A' };

  it('lanza si el challengeToken no matchea, no es login_pin, o ya expiró', async () => {
    for (const bad of [null, challenge({ purpose: 'password_reset' }), challenge({ expiresAt: new Date(Date.now() - 1000) })]) {
      const authRepository = buildAuthRepositoryMock();
      authRepository.findActiveOneTimeCodeByChallenge.mockResolvedValue(bad);
      const service = buildService(authRepository, buildCustomersRepositoryMock(), buildTokenRevocationServiceMock());
      await expect(service.verifyLoginPin({ challengeToken: 'ct', pin: '123456', ip: null, userAgent: null })).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });

  it('PIN incorrecto: registra el intento fallido + evento y lanza; no consume el código', async () => {
    const authRepository = buildAuthRepositoryMock();
    authRepository.findActiveOneTimeCodeByChallenge.mockResolvedValue(challenge());
    const service = buildService(authRepository, buildCustomersRepositoryMock(), buildTokenRevocationServiceMock());
    await expect(service.verifyLoginPin({ challengeToken: 'ct', pin: '000000', ip: '1.2.3.4', userAgent: 'ua' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(authRepository.registerOneTimeCodeFailedAttempt).toHaveBeenCalledTimes(1);
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ successful: false, failureReasonCode: 'invalid_login_pin', actorId: '5' }),
    );
    expect(authRepository.consumeOneTimeCode).not.toHaveBeenCalled();
  });

  it('PIN correcto pero el actor ya no existe: consume el código y lanza "ya no está disponible"', async () => {
    const authRepository = buildAuthRepositoryMock();
    authRepository.findActiveOneTimeCodeByChallenge.mockResolvedValue(challenge());
    authRepository.findInternalUserById.mockResolvedValue(null); // reResolveActorRole -> null
    const service = buildService(authRepository, buildCustomersRepositoryMock(), buildTokenRevocationServiceMock());
    await expect(service.verifyLoginPin({ challengeToken: 'ct', pin: '123456', ip: null, userAgent: null })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(authRepository.consumeOneTimeCode).toHaveBeenCalledTimes(1);
  });

  it('PIN correcto y actor vigente: consume el código, registra el login y emite el par de tokens', async () => {
    const authRepository = buildAuthRepositoryMock();
    authRepository.findActiveOneTimeCodeByChallenge.mockResolvedValue(challenge());
    authRepository.findInternalUserById.mockResolvedValue(activeInternalUser);
    authRepository.findCredentialsByActor.mockResolvedValue({ tokenVersion: 2 });
    const service = buildService(authRepository, buildCustomersRepositoryMock(), buildTokenRevocationServiceMock());
    const result = await service.verifyLoginPin({ challengeToken: 'ct', pin: '123456', ip: '1.2.3.4', userAgent: 'ua' });
    expect(result.tokenType).toBe('Bearer');
    expect(result.refreshToken).toBe('fixed-refresh-token');
    expect(authRepository.consumeOneTimeCode).toHaveBeenCalledTimes(1);
    expect(authRepository.recordSuccessfulLogin).toHaveBeenCalledTimes(1);
    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith(
      expect.objectContaining({ successful: true, failureReasonCode: null, actorId: '5' }),
    );
  });
});

/**
 * Hallazgo A-10 de `docs/audit/auditoria-integral-2026-07-30.md`: los intentos de login quedaban en
 * `auth_events` (base), que sirve para investigar UN caso pero no para ver un patrón. Un pico de
 * `invalid_password` sobre muchos identificadores es credential stuffing, y sin serie temporal nadie
 * se entera en el momento.
 *
 * La métrica se emite desde el MISMO embudo que el evento de auditoría (`logAttempt`), justamente
 * para que ninguna rama de fallo pueda olvidarse de contarse.
 */
describe('AuthService — métrica de intentos de login', () => {
  const loginDto = { actorType: 'customer' as const, identifier: '70000000', password: 'correct-password' };

  function buildWithMetrics() {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const metrics = { recordAuthAttempt: jest.fn() };
    customersRepository.findByContactHash.mockResolvedValue({ id: '10', tenantId: '1', lifecycleStatus: 'registered' });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:correct-password',
      tokenVersion: 3,
      lockedUntil: null,
      failedLoginAttempts: 0,
    });
    const service = buildService(
      authRepository,
      customersRepository,
      tokenRevocationService,
      buildMailSenderServiceMock(),
      buildSequelizeMock(),
      metrics,
    );
    return { service, authRepository, customersRepository, metrics };
  }

  it('cuenta el login exitoso como outcome=success', async () => {
    const { service, metrics } = buildWithMetrics();

    await service.login({ tenantId: '1', dto: loginDto, ip: null, userAgent: null });

    expect(metrics.recordAuthAttempt).toHaveBeenCalledWith({ actorType: 'customer', outcome: 'success' });
  });

  it('cuenta la contraseña incorrecta con su código de fallo, no como un genérico', async () => {
    const { service, authRepository, metrics } = buildWithMetrics();
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:otra-password',
      tokenVersion: 3,
      lockedUntil: null,
      failedLoginAttempts: 0,
    });

    await expect(service.login({ tenantId: '1', dto: loginDto, ip: null, userAgent: null })).rejects.toThrow();

    expect(metrics.recordAuthAttempt).toHaveBeenCalledWith({ actorType: 'customer', outcome: 'invalid_password' });
  });

  it('cuenta también el actor inexistente, que es la rama que un instrumentador olvidaría', async () => {
    const { service, customersRepository, metrics } = buildWithMetrics();
    customersRepository.findByContactHash.mockResolvedValue(null);

    await expect(service.login({ tenantId: '1', dto: loginDto, ip: null, userAgent: null })).rejects.toThrow();

    expect(metrics.recordAuthAttempt).toHaveBeenCalledWith({ actorType: 'customer', outcome: 'actor_not_found' });
  });
});

/**
 * ATLAS-SEC-008 — el segundo factor de un actor interno no puede evaporarse.
 *
 * `isSecondFactorRequired` devuelve `false` cuando MailSender no está disponible: sin canal no hay
 * PIN que entregar. Esa degradación es correcta en local y es una rebaja silenciosa de
 * autenticación en producción — verificada en vivo sobre la API real
 * (docs/audit/evidence/live-exploit-2026-08-06.md): un `admin` recibía el par de tokens con solo la
 * contraseña. `env-cross-checks.ts` impide desplegar así; esto cubre la ventana que la
 * configuración no alcanza: el proveedor configurado pero CAÍDO en el instante del login.
 */
describe('AuthService — fail-closed del segundo factor interno en producción', () => {
  const originalNodeEnv = env.NODE_ENV;
  const restoreNodeEnv = () => {
    (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
  };
  const asProduction = () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
  };

  const internalLogin = {
    tenantId: '1',
    dto: { actorType: 'internal_user' as const, identifier: 'ops@atlas.internal', password: 'AtlasBnpl2026' },
    ip: null,
    userAgent: null,
  };

  function buildInternalLoginService(mailEnabled: boolean) {
    const authRepository = buildAuthRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const tokenRevocationService = buildTokenRevocationServiceMock();
    const mailSenderService = buildMailSenderServiceMock();
    mailSenderService.isEnabled.mockReturnValue(mailEnabled);

    authRepository.findInternalUserByEmail.mockResolvedValue({
      id: '5',
      tenantId: '1',
      status: 'active',
      roleCode: 'admin',
      email: 'ops@atlas.internal',
      fullName: 'Ops',
    });
    authRepository.findCredentialsByActor.mockResolvedValue({
      passwordHash: 'hashed:AtlasBnpl2026',
      tokenVersion: 1,
      actorType: 'internal_user',
      actorId: '5',
    });

    return {
      service: buildService(authRepository, customersRepository, tokenRevocationService, mailSenderService),
      authRepository,
    };
  }

  afterEach(restoreNodeEnv);

  it('sin canal de correo, un actor interno NO recibe tokens: 503 en vez de un solo factor', async () => {
    asProduction();
    const { service, authRepository } = buildInternalLoginService(false);

    await expect(service.login(internalLogin)).rejects.toThrow(ServiceUnavailableException);
    expect(authRepository.recordSuccessfulLogin).not.toHaveBeenCalled();
  });

  it('con canal de correo disponible, el login interno sigue exigiendo el PIN', async () => {
    asProduction();
    const { service } = buildInternalLoginService(true);

    const outcome = await service.login(internalLogin);
    expect(isLoginPinChallenge(outcome)).toBe(true);
  });

  it('fuera de producción la degradación se conserva: el backend local no queda inaccesible', async () => {
    const { service } = buildInternalLoginService(false);

    const outcome = await service.login(internalLogin);
    expect(isLoginPinChallenge(outcome)).toBe(false);
  });
});
