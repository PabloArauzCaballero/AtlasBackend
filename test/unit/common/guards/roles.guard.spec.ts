import { describe, expect, it, jest } from '@jest/globals';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../../../src/common/guards/roles.guard.js';
import { AtlasUserRole, AuthenticatedUser, RequestWithAuth } from '../../../../src/common/types/auth.types.js';

/**
 * Fase 3 (auditoría de cobertura): `RolesGuard` estaba en 0% de cobertura pese a ser la puerta de
 * autorización de negocio de los 27 controllers del backend (`@Roles(...)` + `@UseGuards(...,
 * RolesGuard)`). Un bug aquí (por ejemplo, `includes` mal comparado, o un guard que "abre" por
 * error cuando no debería) afectaría absolutamente todos los endpoints al mismo tiempo, incluidos
 * los de negocio crítico (risk-assessments, purchases futuras, operaciones internas).
 *
 * Nivel de importancia: SISTEMA (es infraestructura transversal de autorización), pero con
 * impacto directo de NEGOCIO: si el guard falla abierto, cualquier rol puede ejecutar acciones de
 * negocio crítico (aprobar/rechazar casos de fraude, ver datos de riesgo de otro cliente, etc.).
 */

function buildContext(input: { requiredRoles: AtlasUserRole[] | undefined; user: AuthenticatedUser | undefined }): {
  context: ExecutionContext;
  reflector: Reflector;
} {
  const reflector = { getAllAndOverride: jest.fn(() => input.requiredRoles) } as unknown as Reflector;

  const request: Partial<RequestWithAuth> = { headers: {}, user: input.user };

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, reflector };
}

describe('RolesGuard', () => {
  it('permite el acceso si el endpoint no declara @Roles (requiredRoles vacío/undefined)', () => {
    const { context, reflector } = buildContext({ requiredRoles: undefined, user: undefined });
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('permite el acceso si el rol del usuario autenticado está en la lista requerida', () => {
    const user: AuthenticatedUser = { sub: 'u1', role: 'risk_analyst' };
    const { context, reflector } = buildContext({ requiredRoles: ['risk_analyst', 'admin'], user });
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rechaza con ForbiddenException si el rol del usuario NO está en la lista requerida', () => {
    const user: AuthenticatedUser = { sub: 'u1', role: 'customer' };
    const { context, reflector } = buildContext({ requiredRoles: ['risk_analyst', 'admin'], user });
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(context)).toThrow('El usuario autenticado no tiene permiso para esta operación.');
  });

  it('rechaza con ForbiddenException si el endpoint requiere roles pero no hay usuario en el request (JwtAuthGuard no corrió antes)', () => {
    const { context, reflector } = buildContext({ requiredRoles: ['admin'], user: undefined });
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(context)).toThrow();
  });
});
