import { describe, expect, it } from '@jest/globals';

/**
 * Auditoría de producción (ver docs/audit/external-data.md, hallazgo 2): el
 * `@Roles('admin', 'platform_admin', 'risk_analyst', 'compliance_analyst')` de clase en
 * los controllers `AdminExternalProviders*Controller` da acceso de solo lectura razonable a risk/compliance,
 * pero antes también cubría endpoints de configuración de plataforma y control financiero
 * (cambiar modo de producción de un proveedor, editar política de costo/aprobación manual,
 * aprobar solicitudes costosas) — permitiendo que un analista se autoaprobara llamadas
 * costosas o reconfigurara producción sin ser admin. Este test fija que esos 3 endpoints
 * exigan explícitamente admin/platform_admin, sin depender de infraestructura e2e.
 */
describe('AdminExternalProviders*Controller — restricción de roles administrativos (regression)', () => {
  async function loadController() {
    const { ROLES_KEY } = await import('../../../src/common/decorators/roles.decorator.js');
    const { AdminExternalProvidersConfigController } =
      await import('../../../src/modules/external-data/controllers/admin-external-providers-config.controller.js');
    const { AdminExternalProvidersRequestsController } =
      await import('../../../src/modules/external-data/controllers/admin-external-providers-requests.controller.js');
    const { AdminExternalProvidersReportsController } =
      await import('../../../src/modules/external-data/controllers/admin-external-providers-reports.controller.js');
    return {
      ROLES_KEY,
      AdminExternalProvidersConfigController,
      AdminExternalProvidersRequestsController,
      AdminExternalProvidersReportsController,
    };
  }

  it('requires admin/platform_admin only for PATCH :providerCode/runtime', async () => {
    const { ROLES_KEY, AdminExternalProvidersConfigController } = await loadController();
    const roles = Reflect.getMetadata(ROLES_KEY, AdminExternalProvidersConfigController.prototype.patchRuntime) as string[] | undefined;

    expect(roles).toEqual(expect.arrayContaining(['admin', 'platform_admin']));
    expect(roles).not.toEqual(expect.arrayContaining(['risk_analyst']));
    expect(roles).not.toEqual(expect.arrayContaining(['compliance_analyst']));
  });

  it('requires admin/platform_admin only for PATCH :providerCode/cost-policy/:queryType', async () => {
    const { ROLES_KEY, AdminExternalProvidersConfigController } = await loadController();
    const roles = Reflect.getMetadata(ROLES_KEY, AdminExternalProvidersConfigController.prototype.updateCostPolicy) as string[] | undefined;

    expect(roles).toEqual(expect.arrayContaining(['admin', 'platform_admin']));
    expect(roles).not.toEqual(expect.arrayContaining(['risk_analyst']));
    expect(roles).not.toEqual(expect.arrayContaining(['compliance_analyst']));
  });

  it('requires admin/platform_admin only for POST requests/:requestId/approve', async () => {
    const { ROLES_KEY, AdminExternalProvidersRequestsController } = await loadController();
    const roles = Reflect.getMetadata(ROLES_KEY, AdminExternalProvidersRequestsController.prototype.approveRequest) as string[] | undefined;

    expect(roles).toEqual(expect.arrayContaining(['admin', 'platform_admin']));
    expect(roles).not.toEqual(expect.arrayContaining(['risk_analyst']));
    expect(roles).not.toEqual(expect.arrayContaining(['compliance_analyst']));
  });

  it('keeps read-only endpoints (health) accessible to risk_analyst/compliance_analyst via the class-level roles', async () => {
    const {
      ROLES_KEY,
      AdminExternalProvidersReportsController,
      AdminExternalProvidersConfigController,
      AdminExternalProvidersRequestsController,
    } = await loadController();
    // `health` no tiene @Roles propio -> hereda el de clase; confirmamos que la clase sigue
    // permitiendo el acceso de solo lectura a risk/compliance (no se restringió de más).
    for (const controller of [
      AdminExternalProvidersReportsController,
      AdminExternalProvidersConfigController,
      AdminExternalProvidersRequestsController,
    ]) {
      const classRoles = Reflect.getMetadata(ROLES_KEY, controller) as string[] | undefined;
      expect(classRoles).toEqual(expect.arrayContaining(['risk_analyst', 'compliance_analyst']));
    }
  });
});

describe('ExternalDataRequestsController — consulta genérica sin rol customer (regression)', () => {
  it.each(['executeRequest', 'previewRequest', 'getProviderHealth'] as const)(
    '%s no admite al cliente (consulta libre o health checks con escritura)',
    async (method) => {
      const { ROLES_KEY } = await import('../../../src/common/decorators/roles.decorator.js');
      const { ExternalDataRequestsController } =
        await import('../../../src/modules/external-data/controllers/external-data-requests.controller.js');
      const roles = Reflect.getMetadata(ROLES_KEY, ExternalDataRequestsController.prototype[method]) as string[] | undefined;

      expect(roles).toEqual(expect.arrayContaining(['internal_operator', 'admin']));
      expect(roles).not.toContain('customer');
    },
  );

  it('el resto del controlador sigue abierto al cliente (consentimientos propios)', async () => {
    const { ROLES_KEY } = await import('../../../src/common/decorators/roles.decorator.js');
    const { ExternalDataConsentsController } =
      await import('../../../src/modules/external-data/controllers/external-data-consents.controller.js');
    const { ExternalDataCustomerEvidenceController } =
      await import('../../../src/modules/external-data/controllers/external-data-customer-evidence.controller.js');
    expect(Reflect.getMetadata(ROLES_KEY, ExternalDataConsentsController)).toContain('customer');
    expect(Reflect.getMetadata(ROLES_KEY, ExternalDataCustomerEvidenceController)).toContain('customer');
  });
});
