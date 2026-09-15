/**
 * @file App Nest real con los guards reales y sólo el controlador de Crédito montado (AT-052).
 * @business Lo que se demuestra aquí es el CONTRATO HTTP del recorrido —quién entra, con qué tenant,
 *   qué se valida en el borde y qué se responde—; la persistencia del recorrido se demuestra contra
 *   PostgreSQL en `test/integration/journeys/`.
 * @system Mismo patrón que `test/e2e/loans/support`: JwtAuthGuard + TenantGuard + RolesGuard reales,
 *   servicios como dobles con los métodos que el controlador llama de verdad.
 */
import { jest } from '@jest/globals';
import type { INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../../src/common/services/token-revocation.service.js';
import type { AtlasUserRole } from '../../../../src/common/types/auth.types.js';
import { accessTokenSignOptions } from '../../../../src/common/utils/auth/jwt-claims.util.js';
import { env } from '../../../../src/config/env.js';

export type Revocation = { getCurrentTokenVersion: jest.Mock<(actorType: string, actorId: string) => Promise<number | null>> };

export async function buildJourneyApp(
  controllers: Type<unknown>[],
  serviceProviders: Provider[],
): Promise<{ app: INestApplication; revocation: Revocation }> {
  const revocation: Revocation = { getCurrentTokenVersion: jest.fn(async () => null) };
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [JwtAuthGuard, RolesGuard, TenantGuard, { provide: TokenRevocationService, useValue: revocation }, ...serviceProviders],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, revocation };
}

export function bearer(role: AtlasUserRole, claims: Record<string, unknown>): [string, string] {
  const token = jwt.sign(
    { sub: `e2e-${role}`, role, ...claims },
    env.JWT_ACCESS_TOKEN_SECRET,
    accessTokenSignOptions({ algorithm: 'HS256', expiresIn: '5m' }),
  );
  return ['Authorization', `Bearer ${token}`];
}
