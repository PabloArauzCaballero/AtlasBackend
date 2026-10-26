import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { AuthReauthenticationController } from '../../../src/modules/auth/auth-reauthentication.controller.js';
import { userAgentFrom } from '../../../src/common/utils/http/headers.util.js';

/**
 * La prueba de PIN del cliente antes de cambiar su correo. La identidad sale SIEMPRE del token: si saliera
 * del cuerpo, cualquiera con una sesión pediría la prueba de otra persona.
 */
describe('AuthReauthenticationController', () => {
  const request = { ip: '1.2.3.4', headers: { 'user-agent': 'jest-agent' } } as never;

  function build() {
    const reauthentication = {
      issue: jest.fn(async (..._args: unknown[]) => ({ reauthToken: 't', expiresInSeconds: 300, expiresAt: 'x' })),
    };
    return { controller: new AuthReauthenticationController(reauthentication as never), reauthentication };
  }

  it('emite la prueba para el cliente del token, con su tenant, ip y user-agent', async () => {
    const { controller, reauthentication } = build();
    const cliente = { role: 'customer', customerId: '42', tenantId: '1' } as never;

    await expect(controller.reauthenticate({ password: '1234' }, cliente, request)).resolves.toEqual(
      expect.objectContaining({ reauthToken: 't', expiresInSeconds: 300 }),
    );
    expect(reauthentication.issue).toHaveBeenCalledWith({
      actorType: 'customer',
      actorId: '42',
      tenantId: '1',
      password: '1234',
      ip: '1.2.3.4',
      userAgent: userAgentFrom(request),
    });
  });

  it('un token que no identifica a un cliente no obtiene prueba', async () => {
    const { controller, reauthentication } = build();
    const operador = { role: 'internal_operator', customerId: null, internalUserId: '9' } as never;

    expect(() => controller.reauthenticate({ password: '1234' }, operador, request)).toThrow(UnauthorizedException);
    expect(reauthentication.issue).not.toHaveBeenCalled();
  });
});
