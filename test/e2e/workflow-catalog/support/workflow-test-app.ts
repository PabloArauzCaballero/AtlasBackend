import { jest } from '@jest/globals';
import type { INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { accessTokenSignOptions } from '../../../../src/common/utils/auth/jwt-claims.util.js';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../../src/common/services/token-revocation.service.js';
import type { AtlasUserRole } from '../../../../src/common/types/auth.types.js';
import { env } from '../../../../src/config/env.js';

/**
 * App Nest real con los guards reales y solo los controllers del catálogo de flujos montados.
 *
 * Se ejercita el stack HTTP completo (routing, `JwtAuthGuard`/`TenantGuard`/`RolesGuard`,
 * `ZodValidationPipe` por parámetro), con los servicios mockeados como única frontera: los tests
 * unitarios ya cubren la lógica, y aquí interesa el contrato HTTP —quién entra, qué se valida y qué
 * se responde—, que es lo que un test de servicio no puede demostrar.
 */
export async function buildWorkflowTestApp(controllers: Type<unknown>[], serviceProviders: Provider[]): Promise<INestApplication> {
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

// Sin `tokenVersion` en el payload: el guard no consulta `TokenRevocationService` en ese caso, así
// que no hace falta simular Redis ni la base para firmar un token válido.
export function signWorkflowToken(role: AtlasUserRole, overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { sub: 'e2e-workflow-user', role, ...overrides },
    env.JWT_ACCESS_TOKEN_SECRET,
    accessTokenSignOptions({ algorithm: 'HS256', expiresIn: '5m' }),
  );
}

export function authHeader(role: AtlasUserRole, overrides?: Record<string, unknown>): [string, string] {
  return ['Authorization', `Bearer ${signWorkflowToken(role, overrides)}`];
}
