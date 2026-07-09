import { describe, expect, it } from '@jest/globals';

/**
 * Auditoría de producción (ver docs/audit/external-data.md, hallazgo 2): el
 * `@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')` de clase en
 * `AdminExternalProvidersController` da acceso de solo lectura razonable a risk/compliance,
 * pero antes también cubría endpoints de configuración de plataforma y control financiero
 * (cambiar modo de producción de un proveedor, editar política de costo/aprobación manual,
 * aprobar solicitudes costosas) — permitiendo que un analista se autoaprobara llamadas
 * costosas o reconfigurara producción sin ser admin. Este test fija que esos 3 endpoints
 * exigan explícitamente admin/platform_admin, sin depender de infraestructura e2e.
 */
describe('AdminExternalProvidersController — restricción de roles administrativos (regression)', () => {
  async function loadController() {
    const { ROLES_KEY } = await import('../../../src/common/decorators/roles.decorator.js');
    const { AdminExternalProvidersController } = await import('../../../src/modules/external-data/external-data.controller.js');
    return { ROLES_KEY, AdminExternalProvidersController };
  }

  it('requires admin/platform_admin only for PATCH :providerCode/runtime', async () => {
    const { ROLES_KEY, AdminExternalProvidersController } = await loadController();
    const roles = Reflect.getMetadata(ROLES_KEY, AdminExternalProvidersController.prototype.patchRuntime) as string[] | undefined;

    expect(roles).toEqual(expect.arrayContaining(['admin', 'platform_admin']));
    expect(roles).not.toEqual(expect.arrayContaining(['risk_analyst']));
    expect(roles).not.toEqual(expect.arrayContaining(['compliance_analyst']));
  });

  it('requires admin/platform_admin only for PATCH :providerCode/cost-policy/:queryType', async () => {
    const { ROLES_KEY, AdminExternalProvidersController } = await loadController();
    const roles = Reflect.getMetadata(ROLES_KEY, AdminExternalProvidersController.prototype.updateCostPolicy) as string[] | undefined;

    expect(roles).toEqual(expect.arrayContaining(['admin', 'platform_admin']));
    expect(roles).not.toEqual(expect.arrayContaining(['risk_analyst']));
    expect(roles).not.toEqual(expect.arrayContaining(['compliance_analyst']));
  });

  it('requires admin/platform_admin only for POST requests/:requestId/approve', async () => {
    const { ROLES_KEY, AdminExternalProvidersController } = await loadController();
    const roles = Reflect.getMetadata(ROLES_KEY, AdminExternalProvidersController.prototype.approveRequest) as string[] | undefined;

    expect(roles).toEqual(expect.arrayContaining(['admin', 'platform_admin']));
    expect(roles).not.toEqual(expect.arrayContaining(['risk_analyst']));
    expect(roles).not.toEqual(expect.arrayContaining(['compliance_analyst']));
  });

  it('keeps read-only endpoints (health) accessible to risk_analyst/compliance_analyst via the class-level roles', async () => {
    const { ROLES_KEY, AdminExternalProvidersController } = await loadController();
    // `health` no tiene @Roles propio -> hereda el de clase; confirmamos que la clase sigue
    // permitiendo el acceso de solo lectura a risk/compliance (no se restringió de más).
    const classRoles = Reflect.getMetadata(ROLES_KEY, AdminExternalProvidersController) as string[] | undefined;
    expect(classRoles).toEqual(expect.arrayContaining(['risk_analyst', 'compliance_analyst']));
  });
});
