import { jest } from '@jest/globals';
import type { INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { accessTokenSignOptions } from '../../../src/common/utils/auth/jwt-claims.util.js';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../src/common/services/token-revocation.service.js';
import type { AtlasUserRole } from '../../../src/common/types/auth.types.js';
import { env } from '../../../src/config/env.js';

/**
 * Harness genérico para probar el CONTRATO HTTP de un controlador: guards reales
 * (autenticación, rol, tenant), servicios simulados.
 *
 * Copiado del harness de `test/e2e/loans/support/loans-test-app.ts` para no repetir, en cada
 * módulo nuevo, la misma cablería de guards. Lo único que cambia entre suites son los
 * controladores montados y los servicios que simulan.
 */
export async function buildGenericTestApp(controllers: Type<unknown>[], serviceProviders: Provider[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [
      JwtAuthGuard,
      RolesGuard,
      TenantGuard,
      { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn() } },
      ...serviceProviders,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export function signGenericToken(role: AtlasUserRole, overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { sub: 'e2e-generic-user', role, ...overrides },
    env.JWT_ACCESS_TOKEN_SECRET,
    accessTokenSignOptions({ algorithm: 'HS256', expiresIn: '5m' }),
  );
}

export function authHeader(role: AtlasUserRole, overrides?: Record<string, unknown>): [string, string] {
  return ['Authorization', `Bearer ${signGenericToken(role, overrides)}`];
}

export const TENANT_HEADER: [string, string] = ['x-tenant-id', '1'];
export const IDEMPOTENCY_HEADER: [string, string] = ['x-idempotency-key', 'idem-e2e-generic-1'];
