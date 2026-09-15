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
 * App Nest real con los guards reales y sólo los controladores del libro montados.
 *
 * Los servicios son la única frontera simulada: lo que estas pruebas demuestran es el CONTRATO HTTP
 * —quién entra, qué se valida en el borde y qué se responde—, que es justo lo que una prueba de
 * servicio no puede demostrar. Mover dinero por una ruta mal autorizada no lo detecta ningún test
 * unitario del repartidor de céntimos.
 */
export async function buildLoansTestApp(controllers: Type<unknown>[], serviceProviders: Provider[]): Promise<INestApplication> {
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

export function signLoansToken(role: AtlasUserRole, overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { sub: 'e2e-loans-user', role, ...overrides },
    env.JWT_ACCESS_TOKEN_SECRET,
    accessTokenSignOptions({ algorithm: 'HS256', expiresIn: '5m' }),
  );
}

export function authHeader(role: AtlasUserRole, overrides?: Record<string, unknown>): [string, string] {
  return ['Authorization', `Bearer ${signLoansToken(role, overrides)}`];
}
