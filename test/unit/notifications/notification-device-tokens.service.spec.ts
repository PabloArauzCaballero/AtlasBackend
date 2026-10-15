import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { NotificationDeviceTokensService } from '../../../src/modules/notifications/notification-device-tokens.service.js';

describe('NotificationDeviceTokensService', () => {
  function build() {
    const tokens = {
      upsertDeviceToken: jest.fn(async (..._args: unknown[]) => ({ id: 5, customerId: 9 })),
      deactivateDeviceToken: jest.fn(async (..._args: unknown[]) => ({ id: 5, customerId: 9 })),
    };
    return { service: new NotificationDeviceTokensService(tokens as never), tokens };
  }
  const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
  const internal = { role: 'internal_operator', tenantId: '1', internalUserId: 'u1' } as never;

  it('delegan cuando el acceso es válido', async () => {
    const { service, tokens } = build();
    await service.upsertDeviceToken('1', '9', { platform: 'ios' } as never, customer);
    await service.deactivateDeviceToken('1', '9', 'dt1', customer);
    expect(tokens.upsertDeviceToken).toHaveBeenCalledTimes(1);
    expect(tokens.deactivateDeviceToken).toHaveBeenCalledTimes(1);
  });

  it('registrar un token push es del propio cliente (o de system): un interno no puede colgar su teléfono de otro cliente', async () => {
    const { service, tokens } = build();
    await expect(service.upsertDeviceToken('1', '555', { platform: 'android' } as never, internal)).rejects.toThrow(
      'DEVICE_TOKEN_OWNER_ONLY',
    );
    await expect(service.upsertDeviceToken('1', '99', { platform: 'android' } as never, customer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tokens.upsertDeviceToken).not.toHaveBeenCalled();
    await service.upsertDeviceToken('1', '555', { platform: 'android' } as never, { role: 'system', tenantId: '1' } as never);
    // La baja sí la puede hacer el personal.
    await service.deactivateDeviceToken('1', '555', 'dt1', internal);
    expect(tokens.upsertDeviceToken).toHaveBeenCalledTimes(1);
    expect(tokens.deactivateDeviceToken).toHaveBeenCalledTimes(1);
  });
});
