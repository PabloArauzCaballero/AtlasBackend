import { jest } from '@jest/globals';
import type { INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../../src/common/guards/roles.guard.js';
import { TokenRevocationService } from '../../../../src/common/services/token-revocation.service.js';
import type { AtlasUserRole } from '../../../../src/common/types/auth.types.js';
import { env } from '../../../../src/config/env.js';

/**
 * Levanta una app Nest real (Express + guards reales) que monta SOLO los controllers de
 * systems-ops indicados, con sus servicios mockeados. A diferencia de los tests unitarios de
 * controller (que invocan el método directamente), esto ejercita el stack HTTP completo:
 * routing, JwtAuthGuard/RolesGuard reales, ZodValidationPipe por parámetro, y serialización de
 * la respuesta — con Supertest haciendo las requests.
 */
export async function buildSystemsOpsTestApp(controllers: Type<unknown>[], serviceProviders: Provider[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [
      JwtAuthGuard,
      RolesGuard,
      { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn() } },
      ...serviceProviders,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

// Sin tokenVersion en el payload — igual que scripts/create-dev-jwt.ts, el guard nunca consulta
// TokenRevocationService en ese caso (ver jwt-auth.guard.ts), así que no hace falta simular Redis/DB.
export function signSystemsOpsToken(role: AtlasUserRole, overrides: Record<string, unknown> = {}): string {
  return jwt.sign({ sub: 'e2e-systems-ops-user', role, ...overrides }, env.JWT_ACCESS_TOKEN_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

export function authHeader(role: AtlasUserRole, overrides?: Record<string, unknown>): [string, string] {
  return ['Authorization', `Bearer ${signSystemsOpsToken(role, overrides)}`];
}
