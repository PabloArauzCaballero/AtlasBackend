import { jest } from '@jest/globals';
import type { INestApplication, Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../../src/common/services/token-revocation.service.js';
import type { AtlasUserRole } from '../../../../src/common/types/auth.types.js';
import { env } from '../../../../src/config/env.js';
import { NotificationsController } from '../../../../src/modules/notifications/notifications.controller.js';

/**
 * Igual patrón que test/e2e/systems-ops/support/systems-ops-test-app.ts: app Nest real (Express +
 * guards reales) montando solo `NotificationsController`, con `NotificationsService` mockeado.
 * `NotificationsController` suma `TenantGuard` a la combinación habitual — a diferencia de
 * systems-ops, valida que `x-tenant-id` (si se envía) coincida con el `tenantId` del token.
 */
export async function buildNotificationsTestApp(services: Provider[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [NotificationsController],
    providers: [
      JwtAuthGuard,
      RolesGuard,
      TenantGuard,
      { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn() } },
      ...services,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export function signNotificationsToken(role: AtlasUserRole, overrides: Record<string, unknown> = {}): string {
  return jwt.sign({ sub: 'e2e-notifications-user', role, tenantId: '1', ...overrides }, env.JWT_ACCESS_TOKEN_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

export function authHeader(role: AtlasUserRole, overrides?: Record<string, unknown>): [string, string] {
  return ['Authorization', `Bearer ${signNotificationsToken(role, overrides)}`];
}
