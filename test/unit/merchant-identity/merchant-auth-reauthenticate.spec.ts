import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { MerchantAuthController } from '../../../src/modules/merchant-identity/merchant-auth.controller.js';
import { merchantReauthenticateSchema } from '../../../src/modules/merchant-identity/merchant-identity.schemas.js';

/**
 * ERP-03 — `POST /merchant/auth/reauthenticate`: la contraseña repetida con la sesión abierta.
 *
 * Quién se reautentica sale del TOKEN, nunca del cuerpo (que sólo lleva la contraseña), y sólo un
 * usuario de comercio puede pedirla. El freno por IP es el del cambio de contraseña.
 */
describe('MerchantAuthController · reautenticación', () => {
  function build() {
    const reauth = { issue: jest.fn(async (..._args: unknown[]) => ({ reauthToken: 't', expiresInSeconds: 300, expiresAt: 'x' })) };
    const controller = new MerchantAuthController({} as never, reauth as never);
    return { controller, reauth };
  }
  const peticion = { ip: '10.0.0.1', headers: { 'user-agent': 'jest' } } as never;

  it('emite la prueba para el comercio del token, con su red', async () => {
    const { controller, reauth } = build();

    const result = await controller.reauthenticate(
      { sub: 'm', merchantUserId: '55', tenantId: '1', role: 'merchant' },
      { password: 'x' },
      peticion,
    );

    expect(result).toMatchObject({ reauthToken: 't', expiresInSeconds: 300 });
    expect(reauth.issue).toHaveBeenCalledWith({
      actorType: 'merchant_user',
      actorId: '55',
      tenantId: '1',
      password: 'x',
      ip: '10.0.0.1',
      userAgent: 'jest',
    });
  });

  it('un token que no es de comercio no obtiene prueba', () => {
    const { controller, reauth } = build();

    expect(() => controller.reauthenticate({ sub: 'u', internalUserId: '8', role: 'admin' }, { password: 'x' }, peticion)).toThrow(
      UnauthorizedException,
    );
    expect(reauth.issue).not.toHaveBeenCalled();
  });

  it('el cuerpo sólo admite la contraseña, no vacía', () => {
    expect(merchantReauthenticateSchema.safeParse({ password: '' }).success).toBe(false);
    expect(merchantReauthenticateSchema.safeParse({ password: 'x'.repeat(129) }).success).toBe(false);
    expect(merchantReauthenticateSchema.safeParse({ password: 'secreta' }).success).toBe(true);
  });

  it('limita a 5 intentos por minuto', () => {
    const handler = (MerchantAuthController.prototype as unknown as Record<string, object>).reauthenticate;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler as object)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler as object)).toBe(60_000);
  });
});
