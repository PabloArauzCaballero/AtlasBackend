import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { AuthController } from '../../../src/modules/auth/auth.controller.js';
import { tenantIdFromHeader, userAgentFrom } from '../../../src/common/utils/http/headers.util.js';

/**
 * Wiring del `AuthController` (Fase 1.2): los 8 endpoints delegan en `AuthService` extrayendo tenant
 * (x-tenant-id), IP y user-agent del request. Antes solo estaban cubiertos indirecto (funcs 11%). El
 * spec mockea el servicio y verifica el passthrough + la guarda de rol de MFA.
 */
describe('AuthController', () => {
  const request = { ip: '1.2.3.4', headers: { 'user-agent': 'jest-agent' } } as never;
  const ip = '1.2.3.4';
  const userAgent = userAgentFrom(request);
  const tenantId = tenantIdFromHeader('1');

  function build() {
    const authService = {
      login: jest.fn(async (..._args: unknown[]) => ({ accessToken: 'a' })),
      verifyLoginPin: jest.fn(async (..._args: unknown[]) => ({ accessToken: 'a' })),
      requestPasswordReset: jest.fn(async (..._args: unknown[]) => ({ ok: true })),
      confirmPasswordReset: jest.fn(async (..._args: unknown[]) => ({ ok: true })),
      refresh: jest.fn(async (..._args: unknown[]) => ({ accessToken: 'a' })),
      logout: jest.fn(async (..._args: unknown[]) => ({ ok: true })),
      setCustomerMfaPreference: jest.fn(async (..._args: unknown[]) => ({ mfaEnabled: true })),
      provisionCredentials: jest.fn(async (..._args: unknown[]) => ({ ok: true })),
    };
    return { controller: new AuthController(authService as never), authService };
  }

  it('login delega con tenant, ip y user-agent', async () => {
    const { controller, authService } = build();
    const dto = { actorType: 'customer', identifier: 'a@x.com', password: 'pw' } as never;
    await controller.login('1', dto, request);
    expect(authService.login).toHaveBeenCalledWith({ tenantId, dto, ip, userAgent });
  });

  it('verifyLoginPin delega el challengeToken + pin con ip/user-agent', async () => {
    const { controller, authService } = build();
    await controller.verifyLoginPin({ challengeToken: 'ct', pin: '123456' } as never, request);
    expect(authService.verifyLoginPin).toHaveBeenCalledWith({ challengeToken: 'ct', pin: '123456', ip, userAgent });
  });

  it('requestPasswordReset y confirmPasswordReset delegan con tenant y red', async () => {
    const { controller, authService } = build();
    await controller.requestPasswordReset('1', { actorType: 'internal_user', identifier: 'a@x.com' } as never, request);
    expect(authService.requestPasswordReset).toHaveBeenCalledWith({
      tenantId,
      actorType: 'internal_user',
      identifier: 'a@x.com',
      ip,
      userAgent,
    });
    await controller.confirmPasswordReset(
      '1',
      { actorType: 'internal_user', identifier: 'a@x.com', code: '000000', newPassword: 'NewPass1!' } as never,
      request,
    );
    expect(authService.confirmPasswordReset).toHaveBeenCalledWith({
      tenantId,
      actorType: 'internal_user',
      identifier: 'a@x.com',
      code: '000000',
      newPassword: 'NewPass1!',
      ip,
      userAgent,
    });
  });

  it('refresh y logout delegan (logout pasa allDevices)', async () => {
    const { controller, authService } = build();
    await controller.refresh({ refreshToken: 'rt' } as never, request);
    expect(authService.refresh).toHaveBeenCalledWith({ refreshToken: 'rt', ip, userAgent });
    await controller.logout({ refreshToken: 'rt', allDevices: true } as never);
    expect(authService.logout).toHaveBeenCalledWith({ refreshToken: 'rt', allDevices: true });
  });

  it('setMfaPreference: un cliente configura su MFA; un no-cliente recibe Forbidden', async () => {
    const { controller, authService } = build();
    await controller.setMfaPreference({ enabled: true } as never, { role: 'customer', customerId: '9' } as never);
    expect(authService.setCustomerMfaPreference).toHaveBeenCalledWith({ actorId: '9', enabled: true });
    expect(() => controller.setMfaPreference({ enabled: true } as never, { role: 'internal_operator' } as never)).toThrow(
      ForbiddenException,
    );
  });

  // ATLAS-SEC-007: el TENANT del token es tan parte de la autorización como el rol. `TenantGuard`
  // no cubre este endpoint (el actor destino viaja en el cuerpo), así que si el controller no
  // propaga `tenantId`, el servicio no tiene con qué contener la provisión entre tenants.
  it('provisionCredentials delega el body + el rol Y el tenant del actor autenticado', async () => {
    const { controller, authService } = build();
    const body = { actorType: 'internal_user', actorId: '5', password: 'Init1234!' } as never;
    await controller.provisionCredentials(body, { role: 'admin', tenantId: '1' } as never);
    expect(authService.provisionCredentials).toHaveBeenCalledWith(body, { role: 'admin', tenantId: '1' });
  });

  it('provisionCredentials propaga tenantId null cuando el token no lo trae (platform_admin)', async () => {
    const { controller, authService } = build();
    const body = { actorType: 'platform_user', actorId: '9', password: 'Init1234!' } as never;
    await controller.provisionCredentials(body, { role: 'platform_admin' } as never);
    expect(authService.provisionCredentials).toHaveBeenCalledWith(body, { role: 'platform_admin', tenantId: null });
  });
});
