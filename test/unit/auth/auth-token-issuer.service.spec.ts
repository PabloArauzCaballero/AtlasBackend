import { describe, expect, it, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { AuthTokenIssuerService } from '../../../src/modules/auth/auth-token-issuer.service.js';
import { AuthOneTimeCodeRepository } from '../../../src/modules/auth/auth-one-time-code.repository.js';
import { env } from '../../../src/config/env.js';

/**
 * Emisión de credenciales de sesión fuera del login.
 *
 * El registro de un cliente abre su propia sesión: `POST /customer-onboarding/start` devolvía sólo
 * identificadores y el paso siguiente del flujo —verificar el contacto— está detrás del guard, así
 * que la app tenía que encadenar un `POST /auth/login` con la contraseña recién elegida. Estas
 * pruebas fijan que esos tokens se emiten con el mismo algoritmo y forma de claims que el login, y
 * dentro de la transacción del alta.
 */
describe('AuthTokenIssuerService.issueRegistrationTokens', () => {
  function build() {
    const authRepository = { createRefreshToken: jest.fn(async (..._args: unknown[]) => ({ id: 'refresh-1' })) };
    return { service: new AuthTokenIssuerService(authRepository as never), authRepository };
  }

  const input = {
    tenantId: '1',
    customerId: '42',
    tokenVersion: 3,
    ipAddress: '10.0.0.1',
    userAgent: 'AtlasApp/1.0',
  };

  it('emite un access token de cliente con tenant, rol y tokenVersion', async () => {
    const { service } = build();

    const result = await service.issueRegistrationTokens(input);

    const claims = jwt.verify(result.accessToken, env.JWT_ACCESS_TOKEN_SECRET) as Record<string, unknown>;
    expect(claims).toMatchObject({ sub: '42', role: 'customer', tokenVersion: 3, tenantId: '1' });
    expect(result).toMatchObject({ tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN });
    expect(result.refreshToken).toEqual(expect.any(String));
  });

  /**
   * Si el alta se deshace, el refresh token emitido se deshace con ella: emitirlo después del commit
   * dejaría una credencial válida para un cliente que la base todavía no confirmó.
   */
  it('persiste el refresh token dentro de la transacción del alta', async () => {
    const { service, authRepository } = build();
    const transaction = {} as never;

    await service.issueRegistrationTokens({ ...input, transaction });

    const [values, options] = (authRepository.createRefreshToken as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(values).toMatchObject({ tenantId: '1', actorType: 'customer', actorId: '42', ipAddress: '10.0.0.1' });
    // Nunca el token en claro: sólo su hash.
    expect(values.tokenHash).toEqual(expect.any(String));
    expect(options).toEqual({ transaction });
  });
});

describe('AuthOneTimeCodeRepository.findActiveOneTimeCodeByActor', () => {
  it('busca el último código NO consumido de ese actor y propósito', async () => {
    const oneTimeCodeModel = { findOne: jest.fn(async (..._args: unknown[]) => null) };
    const repository = new AuthOneTimeCodeRepository(oneTimeCodeModel as never);

    await repository.findActiveOneTimeCodeByActor('customer', '42', 'login_pin');

    expect((oneTimeCodeModel.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { actorType: 'customer', actorId: '42', purpose: 'login_pin', consumedAt: null },
      order: [['id', 'DESC']],
    });
  });
});
