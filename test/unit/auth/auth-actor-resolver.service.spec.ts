import { describe, expect, it, jest } from '@jest/globals';

// El correo del cliente se guarda cifrado con envelope encryption; aquí solo interesa que el
// resolutor lo BUSQUE y lo descifre, no el algoritmo, que tiene su propio spec.
jest.mock('../../../src/common/utils/crypto/envelope-encryption.util.js', () => ({
  decryptSecretEnvelope: jest.fn(async (..._args: unknown[]) => 'ana@example.com'),
}));

import { AuthActorResolverService, isKnownRole } from '../../../src/modules/auth/auth-actor-resolver.service.js';
import { decryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';

/**
 * `AuthActorResolverService` se extrajo de `AuthService` (Fase 2.2) para unificar la resolución de
 * actor (cliente / usuario interno / usuario de plataforma) que comparten login, verificación de PIN,
 * reset de contraseña y rotación de refresh. Hoy solo se cubría de forma indirecta vía
 * `auth.service.spec`; este spec directo ejercita cada rama de fuente y de estado.
 */
describe('AuthActorResolverService', () => {
  function build() {
    const authRepository = {
      findInternalUserByEmail: jest.fn(async (..._args: unknown[]) => null),
      findPlatformUserByEmail: jest.fn(async (..._args: unknown[]) => null),
      findInternalUserById: jest.fn(async (..._args: unknown[]) => null),
      findPlatformUserById: jest.fn(async (..._args: unknown[]) => null),
    };
    const customersRepository = {
      findByContactHash: jest.fn(async (..._args: unknown[]) => null),
      findById: jest.fn(async (..._args: unknown[]) => null),
      findContactMethods: jest.fn(async (..._args: unknown[]) => []),
    };
    const merchantActorRepository = {
      findMerchantUserByEmail: jest.fn(async (..._args: unknown[]) => null),
      findMerchantUserById: jest.fn(async (..._args: unknown[]) => null),
      touchMerchantUserLogin: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const service = new AuthActorResolverService(
      authRepository as never,
      customersRepository as never,
      merchantActorRepository as never,
    );
    return { service, authRepository, customersRepository, merchantActorRepository };
  }

  it('isKnownRole reconoce roles válidos y rechaza desconocidos', () => {
    expect(isKnownRole('admin')).toBe(true);
    expect(isKnownRole('customer')).toBe(true);
    expect(isKnownRole('not-a-role')).toBe(false);
  });

  // --- resolveActorForLogin: cliente ----------------------------------------------------------

  it('resolveActorForLogin(customer) devuelve actor con email cuando el identificador es un correo', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({
      id: 'c1',
      tenantId: 't1',
      lifecycleStatus: 'active',
    } as never);
    const actor = await service.resolveActorForLogin('t1', 'customer', 'user@mail.com');
    expect(actor).toEqual({ id: 'c1', tenantId: 't1', role: 'customer', email: 'user@mail.com', displayName: null });
  });

  /**
   * Antes, entrar con el TELÉFONO devolvía siempre `email: null`, y como
   * `AuthPasswordResetService` corta cuando no hay email, la recuperación de contraseña quedaba
   * silenciosamente muerta incluso para clientes que sí tenían un correo registrado y verificado.
   */
  it('resolveActorForLogin(customer) recupera el correo registrado cuando el identificador es un teléfono', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({
      id: 'c1',
      tenantId: 't1',
      lifecycleStatus: 'active',
    } as never);
    (customersRepository.findContactMethods as jest.Mock).mockResolvedValueOnce([
      { contactType: 'email', status: 'verified', contactValueEncrypted: 'envelope-1' },
    ] as never);
    const actor = await service.resolveActorForLogin('t1', 'customer', '5215500000000');
    expect(actor?.email).toBe('ana@example.com');
  });

  it('resolveActorForLogin(customer) deja email null cuando el cliente no tiene ningún correo registrado', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({
      id: 'c1',
      tenantId: 't1',
      lifecycleStatus: 'active',
    } as never);
    (customersRepository.findContactMethods as jest.Mock).mockResolvedValueOnce([
      { contactType: 'phone', status: 'verified', contactValueEncrypted: 'envelope-2' },
    ] as never);
    const actor = await service.resolveActorForLogin('t1', 'customer', '5215500000000');
    expect(actor?.email).toBeNull();
  });

  it('resolveActorForLogin(customer) usa el primer correo declarado si ninguno está verificado', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({
      id: 'c1',
      tenantId: 't1',
      lifecycleStatus: 'active',
    } as never);
    (customersRepository.findContactMethods as jest.Mock).mockResolvedValueOnce([
      { contactType: 'email', status: 'declared', contactValueEncrypted: 'envelope-declared' },
    ] as never);
    await expect(service.resolveActorForLogin('t1', 'customer', '5215500000000')).resolves.toMatchObject({
      email: 'ana@example.com',
    });
  });

  it('resolveActorForLogin(customer) degrada a email null si el sobre no puede descifrarse', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({
      id: 'c1',
      tenantId: 't1',
      lifecycleStatus: 'active',
    } as never);
    (customersRepository.findContactMethods as jest.Mock).mockResolvedValueOnce([
      { contactType: 'email', status: 'verified', contactValueEncrypted: 'broken-envelope' },
    ] as never);
    (decryptSecretEnvelope as jest.Mock).mockRejectedValueOnce(new Error('invalid envelope') as never);
    await expect(service.resolveActorForLogin('t1', 'customer', '5215500000000')).resolves.toMatchObject({ email: null });
  });

  it('resolveActorForLogin(customer) => null si no existe o está closed', async () => {
    const { service, customersRepository } = build();
    expect(await service.resolveActorForLogin('t1', 'customer', 'x@mail.com')).toBeNull();
    (customersRepository.findByContactHash as jest.Mock).mockResolvedValueOnce({
      id: 'c1',
      tenantId: 't1',
      lifecycleStatus: 'closed',
    } as never);
    expect(await service.resolveActorForLogin('t1', 'customer', 'x@mail.com')).toBeNull();
  });

  // --- resolveActorForLogin: usuario interno --------------------------------------------------

  it('resolveActorForLogin(internal_user) => actor activo con rol conocido', async () => {
    const { service, authRepository } = build();
    (authRepository.findInternalUserByEmail as jest.Mock).mockResolvedValueOnce({
      id: 'u1',
      tenantId: 't1',
      status: 'active',
      roleCode: 'risk_analyst',
      email: 'op@atlas.io',
      fullName: 'Op Uno',
    } as never);
    const actor = await service.resolveActorForLogin('t1', 'internal_user', 'op@atlas.io');
    expect(actor).toEqual({ id: 'u1', tenantId: 't1', role: 'risk_analyst', email: 'op@atlas.io', displayName: 'Op Uno' });
  });

  it('resolveActorForLogin(internal_user) => null si está inactivo o con rol desconocido', async () => {
    const { service, authRepository } = build();
    (authRepository.findInternalUserByEmail as jest.Mock)
      .mockResolvedValueOnce({ id: 'u1', status: 'suspended', roleCode: 'risk_analyst' } as never)
      .mockResolvedValueOnce({ id: 'u1', status: 'active', roleCode: 'wizard' } as never);
    expect(await service.resolveActorForLogin('t1', 'internal_user', 'op@atlas.io')).toBeNull();
    expect(await service.resolveActorForLogin('t1', 'internal_user', 'op@atlas.io')).toBeNull();
  });

  // --- resolveActorForLogin: usuario de plataforma --------------------------------------------

  it('resolveActorForLogin(platform_user) => actor activo con tenantId null', async () => {
    const { service, authRepository } = build();
    (authRepository.findPlatformUserByEmail as jest.Mock).mockResolvedValueOnce({
      id: 'p1',
      status: 'active',
      roleCode: 'platform_admin',
      email: 'boss@atlas.io',
      fullName: 'Boss',
    } as never);
    const actor = await service.resolveActorForLogin('t1', 'platform_user', 'boss@atlas.io');
    expect(actor).toEqual({ id: 'p1', tenantId: null, role: 'platform_admin', email: 'boss@atlas.io', displayName: 'Boss' });
  });

  it('resolveActorForLogin(platform_user) => null si no existe', async () => {
    const { service } = build();
    expect(await service.resolveActorForLogin('t1', 'platform_user', 'nope@atlas.io')).toBeNull();
  });

  // --- reResolveActorRole ---------------------------------------------------------------------

  it('reResolveActorRole(customer) => null si tenantId es null y no consulta el repo', async () => {
    const { service, customersRepository } = build();
    const actor = await service.reResolveActorRole('customer', 'c1', null);
    expect(actor).toBeNull();
    expect(customersRepository.findById).not.toHaveBeenCalled();
  });

  it('reResolveActorRole(customer) => actor con email null si existe y está abierto', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'active' } as never);
    const actor = await service.reResolveActorRole('customer', 'c1', 't1');
    expect(actor).toEqual({ id: 'c1', tenantId: 't1', role: 'customer', email: null, displayName: null });
  });

  it('reResolveActorRole(internal_user) => actor activo con rol conocido', async () => {
    const { service, authRepository } = build();
    (authRepository.findInternalUserById as jest.Mock).mockResolvedValueOnce({
      id: 'u1',
      tenantId: 't1',
      status: 'active',
      roleCode: 'compliance_analyst',
      email: 'c@atlas.io',
      fullName: 'Compliance',
    } as never);
    const actor = await service.reResolveActorRole('internal_user', 'u1', 't1');
    expect(actor?.role).toBe('compliance_analyst');
  });

  it('reResolveActorRole(platform_user) => null si está inactivo', async () => {
    const { service, authRepository } = build();
    (authRepository.findPlatformUserById as jest.Mock).mockResolvedValueOnce({ id: 'p1', status: 'disabled', roleCode: 'admin' } as never);
    expect(await service.reResolveActorRole('platform_user', 'p1', null)).toBeNull();
  });

  it('reResolveActorRole(platform_user) devuelve un actor activo con rol conocido', async () => {
    const { service, authRepository } = build();
    (authRepository.findPlatformUserById as jest.Mock).mockResolvedValueOnce({
      id: 'p1',
      status: 'active',
      roleCode: 'platform_admin',
      email: 'platform@atlas.io',
      fullName: 'Platform Admin',
    } as never);
    await expect(service.reResolveActorRole('platform_user', 'p1', null)).resolves.toEqual({
      id: 'p1',
      tenantId: null,
      role: 'platform_admin',
      email: 'platform@atlas.io',
      displayName: 'Platform Admin',
    });
  });
});
