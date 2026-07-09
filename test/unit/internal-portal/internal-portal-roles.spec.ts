import { describe, expect, it } from '@jest/globals';

/**
 * Auditoría de producción (ver docs/audit/internal-portal.md, hallazgo Crítico): antes de este
 * fix, `InternalPortalController` solo tenía `@UseGuards(JwtAuthGuard)` — sin `RolesGuard` ni
 * `@Roles(...)` en ningún lado. `JwtAuthGuard` únicamente valida que el token sea válido, no el
 * rol del actor: cualquier usuario autenticado, incluido un `customer`, tenía acceso completo a
 * los 17 endpoints de este panel "interno" (metadata de negocio, exports, calidad de datos,
 * gobierno de datos, linaje, alertas — `acknowledgeAlert` ejecuta un UPDATE real —, jobs,
 * reportes). Este test fija que el guard de roles esté presente y que `customer` quede excluido,
 * sin depender de infraestructura e2e.
 */
describe('InternalPortalController — requiere rol interno (regression, no solo autenticación)', () => {
  async function loadController() {
    const { ROLES_KEY } = await import('../../../src/common/decorators/roles.decorator.js');
    const { InternalPortalController } = await import('../../../src/modules/internal-portal/internal-portal.controller.js');
    return { ROLES_KEY, InternalPortalController };
  }

  it('applies RolesGuard in addition to JwtAuthGuard at the class level', async () => {
    const guardsMetadataKey = '__guards__';
    const { InternalPortalController } = await loadController();
    const guards = (Reflect.getMetadata(guardsMetadataKey, InternalPortalController) as unknown[] | undefined) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  it('declares a non-empty role list at the class level that excludes "customer"', async () => {
    const { ROLES_KEY, InternalPortalController } = await loadController();
    const roles = Reflect.getMetadata(ROLES_KEY, InternalPortalController) as string[] | undefined;

    expect(roles).toBeDefined();
    expect(roles!.length).toBeGreaterThan(0);
    expect(roles).not.toEqual(expect.arrayContaining(['customer']));
    expect(roles).not.toEqual(expect.arrayContaining(['merchant']));
  });

  it('includes the internal ops/governance roles used by sibling modules (operations, data-quality, audit)', async () => {
    const { ROLES_KEY, InternalPortalController } = await loadController();
    const roles = Reflect.getMetadata(ROLES_KEY, InternalPortalController) as string[] | undefined;

    expect(roles).toEqual(
      expect.arrayContaining(['internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin']),
    );
  });
});
