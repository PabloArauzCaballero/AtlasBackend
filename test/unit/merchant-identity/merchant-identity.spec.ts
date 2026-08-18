import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../../../src/common/utils/crypto/envelope-encryption.util.js', () => ({
  decryptSecretEnvelope: jest.fn(async (..._args: unknown[]) => 'ana@example.com'),
}));

import { AuthActorResolverService } from '../../../src/modules/auth/auth-actor-resolver.service.js';
import { MerchantUsersService, toMerchantUserProfile } from '../../../src/modules/merchant-identity/merchant-users.service.js';
import {
  createMerchantUserSchema,
  listMerchantUsersQuerySchema,
  merchantLoginSchema,
  updateMerchantUserStatusSchema,
} from '../../../src/modules/merchant-identity/merchant-identity.schemas.js';

/**
 * La identidad del comercio afiliado es la cuarta población autenticable. Lo que este spec protege
 * no es "que funcione el login", sino las dos afirmaciones de las que depende el portal del ERP:
 * que una identidad NO activa no resuelve actor (y por tanto no hay token), y que el alta nace
 * deshabilitada. Si alguna de las dos se rompe, el portal deja de ser fail-closed sin que ninguna
 * prueba del ERP se entere.
 */
describe('Identidad del comercio afiliado', () => {
  function buildResolver() {
    const authRepository = {
      findInternalUserByEmail: jest.fn(async (..._args: unknown[]) => null),
      findPlatformUserByEmail: jest.fn(async (..._args: unknown[]) => null),
      findInternalUserById: jest.fn(async (..._args: unknown[]) => null),
      findPlatformUserById: jest.fn(async (..._args: unknown[]) => null),
    };
    const merchantActorRepository = {
      findMerchantUserByEmail: jest.fn(async (..._args: unknown[]) => null),
      findMerchantUserById: jest.fn(async (..._args: unknown[]) => null),
      touchMerchantUserLogin: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const customersRepository = {
      findByContactHash: jest.fn(async (..._args: unknown[]) => null),
      findById: jest.fn(async (..._args: unknown[]) => null),
      findContactMethods: jest.fn(async (..._args: unknown[]) => []),
    };
    const service = new AuthActorResolverService(
      authRepository as never,
      customersRepository as never,
      customersRepository as never,
      merchantActorRepository as never,
    );
    return { service, authRepository: merchantActorRepository };
  }

  const activeMerchant = {
    id: 'm1',
    tenantId: 't1',
    email: 'comercio@alfa.test',
    roleCode: 'merchant',
    status: 'active',
    fullName: 'Ana Comercio',
  };

  // --- resolución del actor -------------------------------------------------------------------

  it('resuelve al usuario de comercio activo con el rol merchant', async () => {
    const { service, authRepository } = buildResolver();
    (authRepository.findMerchantUserByEmail as jest.Mock).mockResolvedValueOnce(activeMerchant as never);

    const actor = await service.resolveActorForLogin('t1', 'merchant_user', 'comercio@alfa.test');

    expect(actor).toEqual({
      id: 'm1',
      tenantId: 't1',
      role: 'merchant',
      email: 'comercio@alfa.test',
      displayName: 'Ana Comercio',
    });
  });

  it.each(['invited', 'suspended', 'disabled'])('no resuelve actor si la identidad está %s', async (status) => {
    const { service, authRepository } = buildResolver();
    (authRepository.findMerchantUserByEmail as jest.Mock).mockResolvedValueOnce({ ...activeMerchant, status } as never);

    expect(await service.resolveActorForLogin('t1', 'merchant_user', 'comercio@alfa.test')).toBeNull();
  });

  it('no resuelve actor si la identidad no existe', async () => {
    const { service } = buildResolver();
    expect(await service.resolveActorForLogin('t1', 'merchant_user', 'nadie@alfa.test')).toBeNull();
  });

  it('no resuelve actor si el rol no pertenece al vocabulario del guard', async () => {
    const { service, authRepository } = buildResolver();
    (authRepository.findMerchantUserByEmail as jest.Mock).mockResolvedValueOnce({
      ...activeMerchant,
      roleCode: 'dueño_del_universo',
    } as never);

    expect(await service.resolveActorForLogin('t1', 'merchant_user', 'comercio@alfa.test')).toBeNull();
  });

  /** Suspender debe cortar la sesión en la siguiente rotación del refresh, no sólo en el login. */
  it('el refresh deja de resolver cuando la identidad se suspende', async () => {
    const { service, authRepository } = buildResolver();
    (authRepository.findMerchantUserById as jest.Mock).mockResolvedValueOnce({
      ...activeMerchant,
      status: 'suspended',
    } as never);

    expect(await service.reResolveActorRole('merchant_user', 'm1', 't1')).toBeNull();
  });

  // --- alta y ciclo de vida -------------------------------------------------------------------

  function buildUsersService() {
    const created = {
      id: 'm9',
      tenantId: 't1',
      email: 'nueva@alfa.test',
      fullName: 'Nueva Persona',
      userCode: null,
      phone: null,
      roleCode: 'merchant',
      status: 'invited',
      mustChangePassword: true,
      lastLoginAt: null,
    };
    const merchantUserModel = {
      create: jest.fn(async (..._args: unknown[]) => created),
      findOne: jest.fn(async (..._args: unknown[]) => null),
      findAndCountAll: jest.fn(async (..._args: unknown[]) => ({ rows: [], count: 0 })),
    };
    const merchantActorRepository = { findMerchantUserByEmail: jest.fn(async (..._args: unknown[]) => null) };
    const authRepository = { createCredentials: jest.fn(async (..._args: unknown[]) => ({ id: 'cred1' })) };
    const sequelize = { transaction: jest.fn(async (work: never) => (work as (t: unknown) => unknown)({})) };
    const service = new MerchantUsersService(
      merchantUserModel as never,
      authRepository as never,
      merchantActorRepository as never,
      sequelize as never,
    );
    return { service, merchantUserModel, authRepository, merchantActorRepository, created };
  }

  it('el alta nace invited y provisiona la credencial en la misma transacción', async () => {
    const { service, merchantUserModel, authRepository } = buildUsersService();

    const profile = await service.createMerchantUser(
      { email: 'Nueva@Alfa.test', fullName: 'Nueva Persona', password: 'contrasena-larga-9' },
      { tenantId: 't1', internalUserId: 'i1' },
    );

    expect(profile.status).toBe('invited');
    expect(profile.role).toBe('merchant');
    // El correo se normaliza antes de insertar: el índice único de la migración indexa
    // lower(btrim(email)), y guardar sin normalizar deja duplicados que sólo aparecen al iniciar sesión.
    expect((merchantUserModel.create as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      email: 'nueva@alfa.test',
      status: 'invited',
      mustChangePassword: true,
    });
    expect((authRepository.createCredentials as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      actorType: 'merchant_user',
      tenantId: 't1',
    });
  });

  it('rechaza un correo ya usado en el mismo tenant', async () => {
    const { service, merchantActorRepository } = buildUsersService();
    (merchantActorRepository.findMerchantUserByEmail as jest.Mock).mockResolvedValueOnce({ id: 'm1' } as never);

    await expect(
      service.createMerchantUser(
        { email: 'nueva@alfa.test', fullName: 'Nueva Persona', password: 'contrasena-larga-9' },
        { tenantId: 't1', internalUserId: 'i1' },
      ),
    ).rejects.toThrow('MERCHANT_USER_EMAIL_TAKEN');
  });

  it('rechaza una contraseña débil antes de crear nada', async () => {
    const { service, merchantUserModel } = buildUsersService();

    await expect(
      service.createMerchantUser(
        { email: 'nueva@alfa.test', fullName: 'Nueva Persona', password: '1234567890' },
        { tenantId: 't1', internalUserId: 'i1' },
      ),
    ).rejects.toThrow('WEAK_PASSWORD');
    expect(merchantUserModel.create).not.toHaveBeenCalled();
  });

  it('no encuentra identidades de otro tenant', async () => {
    const { service } = buildUsersService();
    await expect(service.getMerchantUser('t2', 'm9')).rejects.toThrow('MERCHANT_USER_NOT_FOUND');
  });

  // --- contrato de entrada --------------------------------------------------------------------

  it('el perfil publicado no expone tenant ni hash', () => {
    const profile = toMerchantUserProfile({ ...activeMerchant, phone: null, userCode: null, mustChangePassword: false } as never);
    expect(Object.keys(profile).sort()).toEqual(
      ['email', 'fullName', 'id', 'lastLoginAt', 'mustChangePassword', 'phone', 'role', 'status', 'userCode'].sort(),
    );
  });

  it('el alta exige contraseña de al menos 10 caracteres y correo válido', () => {
    expect(createMerchantUserSchema.safeParse({ email: 'no-es-correo', fullName: 'Ana', password: 'x'.repeat(12) }).success).toBe(false);
    expect(createMerchantUserSchema.safeParse({ email: 'a@b.test', fullName: 'Ana', password: 'corta' }).success).toBe(false);
  });

  it('el estado sólo admite el vocabulario cerrado que declara la migración', () => {
    expect(updateMerchantUserStatusSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(updateMerchantUserStatusSchema.safeParse({ status: 'god_mode' }).success).toBe(false);
  });

  it('el listado tiene tope duro de página', () => {
    expect(listMerchantUsersQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(listMerchantUsersQuerySchema.parse({}).limit).toBe(25);
  });

  it('el login exige correo y contraseña', () => {
    expect(merchantLoginSchema.safeParse({ email: 'a@b.test', password: 'x' }).success).toBe(true);
    expect(merchantLoginSchema.safeParse({ email: 'a@b.test' }).success).toBe(false);
  });
});
