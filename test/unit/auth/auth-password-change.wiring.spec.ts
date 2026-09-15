import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { AuthPasswordChangeController } from '../../../src/modules/auth/auth-password-change.controller.js';
import { AuthPasswordChangeRepository } from '../../../src/modules/auth/auth-password-change.repository.js';
import type { AuthPasswordChangeService } from '../../../src/modules/auth/auth-password-change.service.js';
import type { AuthRepository } from '../../../src/modules/auth/auth.repository.js';
import type { AuthCredentialModel, InternalUserModel, MerchantUserModel } from '../../../src/database/models/index.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';
import type { RequestWithNetwork } from '../../../src/common/utils/http/headers.util.js';

/**
 * El cambio de contraseña de la cuenta autenticada.
 *
 * Dos cosas se fijan y ninguna se ve fallar. La primera es el ORDEN de las tres escrituras: la
 * contraseña se guarda PRIMERO —al revés, bajar la bandera y fallar al guardar deja una cuenta con
 * su contraseña temporal intacta y sin nada que le recuerde al usuario que lo sigue siendo— y la
 * revocación va la ÚLTIMA, porque revocar antes de guardar echa al usuario de su sesión para
 * dejarle después la contraseña vieja, que es la peor de las cuatro combinaciones.
 *
 * La segunda es de dónde sale la identidad: del access token y nunca del cuerpo. Un token sin
 * ningún identificador de actor se RECHAZA en vez de asumir `platform_user`, que es el actor con
 * más alcance de todos; aquí esa suposición sería la diferencia entre informar mal un perfil y
 * escribir la contraseña de la cuenta equivocada.
 */
function peticion(): RequestWithNetwork {
  return { ip: '10.0.0.1', headers: { 'user-agent': 'atlas-app/1.0' } } as unknown as RequestWithNetwork;
}

function usuario(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { tenantId: 't1', role: 'customer', ...overrides } as AuthenticatedUser;
}

describe('AuthPasswordChangeRepository', () => {
  let authRepository: {
    findCredentialsByActor: jest.Mock;
    updatePasswordHash: jest.Mock;
    revokeAllRefreshTokensForActor: jest.Mock;
    recordLoginAttemptEvent: jest.Mock;
  };
  let internalUsers: { update: jest.Mock };
  let merchantUsers: { update: jest.Mock };
  let repo: AuthPasswordChangeRepository;
  let orden: string[];

  beforeEach(() => {
    orden = [];
    authRepository = {
      findCredentialsByActor: jest.fn(async () => null),
      updatePasswordHash: jest.fn(async () => {
        orden.push('guardar');
      }),
      revokeAllRefreshTokensForActor: jest.fn(async () => {
        orden.push('revocar');
      }),
      recordLoginAttemptEvent: jest.fn(async () => undefined),
    };
    internalUsers = {
      update: jest.fn(async () => {
        orden.push('bandera:interno');
      }),
    };
    merchantUsers = {
      update: jest.fn(async () => {
        orden.push('bandera:comercio');
      }),
    };
    repo = new AuthPasswordChangeRepository(
      authRepository as unknown as AuthRepository,
      internalUsers as unknown as typeof InternalUserModel,
      merchantUsers as unknown as typeof MerchantUserModel,
    );
  });

  it('la credencial se pide al repositorio de auth: no hay una segunda fuente de verdad', async () => {
    await repo.findCredential('internal_user', '7');

    expect(authRepository.findCredentialsByActor).toHaveBeenCalledWith('internal_user', '7');
  });

  it('guarda la contraseña PRIMERO, baja la bandera después y revoca al final', async () => {
    await repo.applyNewPassword({
      actorType: 'internal_user',
      actorId: '7',
      credential: { id: 1 } as unknown as AuthCredentialModel,
      passwordHash: 'hash-nuevo',
    });

    expect(orden).toEqual(['guardar', 'bandera:interno', 'revocar']);
    expect(authRepository.revokeAllRefreshTokensForActor).toHaveBeenCalledWith('internal_user', '7', 'password_change');
  });

  it('un empleado del comercio baja su bandera en su propia tabla', async () => {
    await repo.applyNewPassword({
      actorType: 'merchant_user',
      actorId: '9',
      credential: {} as unknown as AuthCredentialModel,
      passwordHash: 'h',
    });

    expect(orden).toEqual(['guardar', 'bandera:comercio', 'revocar']);
    expect(merchantUsers.update).toHaveBeenCalledWith(expect.objectContaining({ mustChangePassword: false }), { where: { id: '9' } });
  });

  it('un cliente no tiene esa bandera: es un no-op deliberado, no un error, y el cambio se completa igual', async () => {
    await repo.applyNewPassword({
      actorType: 'customer',
      actorId: '42',
      credential: {} as unknown as AuthCredentialModel,
      passwordHash: 'h',
    });

    expect(orden).toEqual(['guardar', 'revocar']);
    expect(internalUsers.update).not.toHaveBeenCalled();
    expect(merchantUsers.update).not.toHaveBeenCalled();
  });

  it('la bitácora traduce ip y agente a los nombres que espera el repositorio de auth', async () => {
    await repo.recordEvent({
      tenantId: 't1',
      actorType: 'customer',
      actorId: '42',
      eventType: 'password_change',
      successful: false,
      failureReasonCode: 'WRONG_PASSWORD',
      ip: '10.0.0.1',
      userAgent: 'atlas-app/1.0',
    });

    expect(authRepository.recordLoginAttemptEvent).toHaveBeenCalledWith({
      tenantId: 't1',
      actorType: 'customer',
      actorId: '42',
      eventType: 'password_change',
      successful: false,
      failureReasonCode: 'WRONG_PASSWORD',
      ipAddress: '10.0.0.1',
      userAgent: 'atlas-app/1.0',
    });
  });
});

describe('AuthPasswordChangeController', () => {
  let passwordChange: { requestPasswordChange: jest.Mock; confirmPasswordChange: jest.Mock };
  let controller: AuthPasswordChangeController;

  beforeEach(() => {
    passwordChange = {
      requestPasswordChange: jest.fn(async () => ({ pinChallengeRequired: true })),
      confirmPasswordChange: jest.fn(async () => ({ passwordChanged: true })),
    };
    controller = new AuthPasswordChangeController(passwordChange as unknown as AuthPasswordChangeService);
  });

  it('quién cambia la contraseña sale del token y no del cuerpo', async () => {
    await controller.requestPasswordChange({ currentPassword: 'vieja' }, usuario({ customerId: '42' }), peticion());

    expect(passwordChange.requestPasswordChange).toHaveBeenCalledWith({
      actorType: 'customer',
      actorId: '42',
      tenantId: 't1',
      currentPassword: 'vieja',
      ip: '10.0.0.1',
      userAgent: 'atlas-app/1.0',
    });
  });

  it('la confirmación lleva el desafío, el código y la contraseña nueva del cuerpo, con el actor del token', async () => {
    await controller.confirmPasswordChange(
      { challengeToken: 'ch-1', code: '123456', newPassword: 'nueva' },
      usuario({ internalUserId: '7' }),
      peticion(),
    );

    expect(passwordChange.confirmPasswordChange).toHaveBeenCalledWith({
      actorType: 'internal_user',
      actorId: '7',
      tenantId: 't1',
      challengeToken: 'ch-1',
      code: '123456',
      newPassword: 'nueva',
      ip: '10.0.0.1',
      userAgent: 'atlas-app/1.0',
    });
  });

  it('el actor más específico gana si el token trajera más de un identificador', async () => {
    await controller.requestPasswordChange(
      { currentPassword: 'x' },
      usuario({ customerId: '42', merchantUserId: '9', internalUserId: '7', platformUserId: '1' }),
      peticion(),
    );

    expect(passwordChange.requestPasswordChange).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'customer', actorId: '42' }));
  });

  it('el orden de precedencia baja de comercio a interno y de interno a plataforma', async () => {
    await controller.requestPasswordChange({ currentPassword: 'x' }, usuario({ merchantUserId: '9', platformUserId: '1' }), peticion());
    expect(passwordChange.requestPasswordChange).toHaveBeenLastCalledWith(expect.objectContaining({ actorType: 'merchant_user' }));

    await controller.requestPasswordChange({ currentPassword: 'x' }, usuario({ platformUserId: '1' }), peticion());
    expect(passwordChange.requestPasswordChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ actorType: 'platform_user', actorId: '1' }),
    );
  });

  it('un token que no identifica a nadie se rechaza en vez de asumir el actor con más alcance', () => {
    expect(() => controller.requestPasswordChange({ currentPassword: 'x' }, usuario(), peticion())).toThrow(UnauthorizedException);
    expect(() => controller.confirmPasswordChange({ challengeToken: 'c', code: '1', newPassword: 'n' }, usuario(), peticion())).toThrow(
      UnauthorizedException,
    );
    expect(passwordChange.requestPasswordChange).not.toHaveBeenCalled();
  });

  it('sin tenant en el token viaja nulo y no la cadena «undefined»', async () => {
    await controller.requestPasswordChange({ currentPassword: 'x' }, { customerId: '42' } as AuthenticatedUser, peticion());

    expect(passwordChange.requestPasswordChange).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null }));
  });

  it('sin ip en la petición viaja nulo: la bitácora distingue «no se supo» de una ip vacía', async () => {
    await controller.requestPasswordChange({ currentPassword: 'x' }, usuario({ customerId: '42' }), {
      headers: {},
    } as unknown as RequestWithNetwork);

    expect(passwordChange.requestPasswordChange).toHaveBeenCalledWith(expect.objectContaining({ ip: null }));
  });
});
