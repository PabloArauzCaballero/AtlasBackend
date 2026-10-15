import { describe, expect, it, jest } from '@jest/globals';
import { AdminExternalProvidersConfigController } from '../../../src/modules/external-data/controllers/admin-external-providers-config.controller.js';
import { AdminExternalProvidersReportsController } from '../../../src/modules/external-data/controllers/admin-external-providers-reports.controller.js';
import { AdminExternalProvidersRequestsController } from '../../../src/modules/external-data/controllers/admin-external-providers-requests.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';
import { actorId } from '../../../src/modules/external-data/external-data-controller.util.js';

/**
 * Controllers de administración (`admin/external-providers`): reportes, configuración y solicitudes.
 * Wiring fino sobre los servicios de aplicación; se inyecta UN mock con los métodos de todos en cada
 * posición del constructor.
 */
function buildAdminControllers(svc: unknown) {
  const s = svc as never;
  return {
    // orden del constructor: preview, registry, readiness, reporting
    reports: new AdminExternalProvidersReportsController(s, s, s, s),
    // execution, governance
    config: new AdminExternalProvidersConfigController(s, s),
    // evidence, governance, convenience
    requests: new AdminExternalProvidersRequestsController(s, s, s),
  };
}

describe('Controllers de administración de proveedores (reportes, configuración, solicitudes)', () => {
  const user = { role: 'admin', tenantId: '1', internalUserId: 'a1' } as never;
  const tenantId = tenantIdFromHeader('1', user);

  function service() {
    return {
      listProviders: jest.fn(async (..._args: unknown[]) => []),
      getProviderHealth: jest.fn(async (..._args: unknown[]) => []),
      getProviderReadiness: jest.fn(async (..._args: unknown[]) => ({})),
      auditExternalProvidersQuality: jest.fn(async (..._args: unknown[]) => []),
      getProductionGate: jest.fn(async (..._args: unknown[]) => ({})),
      getProviderSlaReport: jest.fn(async (..._args: unknown[]) => ({})),
      getProviderUsage: jest.fn(async (..._args: unknown[]) => ({})),
      auditIdempotencyKeys: jest.fn(async (..._args: unknown[]) => []),
      getRetentionPreview: jest.fn(async (..._args: unknown[]) => ({})),
      auditResponseSanitization: jest.fn(async (..._args: unknown[]) => []),
      previewExternalDataRequest: jest.fn(async (..._args: unknown[]) => ({})),
      updateProviderRuntimePolicy: jest.fn(async (..._args: unknown[]) => ({})),
      activateProviderKillSwitch: jest.fn(async (..._args: unknown[]) => ({})),
      getProviderCostPolicies: jest.fn(async (..._args: unknown[]) => []),
      updateProviderCostPolicy: jest.fn(async (..._args: unknown[]) => ({})),
      executeExternalDataRequest: jest.fn(async (..._args: unknown[]) => ({})),
      approveRequest: jest.fn(async (..._args: unknown[]) => ({})),
      retryProviderRequest: jest.fn(async (..._args: unknown[]) => ({})),
      rebuildFeatureSnapshotFromRequest: jest.fn(async (..._args: unknown[]) => ({})),
    };
  }

  it('lecturas sin argumentos (providers, health, readiness, quality-audit)', async () => {
    const svc = service();
    const c = buildAdminControllers(svc);
    await c.reports.listProviders();
    await c.reports.health();
    await c.reports.readiness();
    await c.reports.qualityAudit();
    expect(svc.listProviders).toHaveBeenCalled();
    expect(svc.getProviderHealth).toHaveBeenCalledWith();
    expect(svc.getProviderReadiness).toHaveBeenCalled();
    expect(svc.auditExternalProvidersQuality).toHaveBeenCalled();
  });

  it('reportes con tenant/filtros (production-gate, sla, usage, idempotency, retention, sanitization)', async () => {
    const svc = service();
    const c = buildAdminControllers(svc);
    await c.reports.productionGate({ providerCode: 'SEGIP', strict: true } as never);
    expect(svc.getProductionGate).toHaveBeenCalledWith({ providerCode: 'SEGIP', strict: true });
    await c.reports.sla('1', { providerCode: 'SEGIP', days: 7 } as never);
    expect(svc.getProviderSlaReport).toHaveBeenCalledWith({ tenantId, providerCode: 'SEGIP', days: 7 });
    await c.reports.usage('1', { providerCode: 'SEGIP', days: 30 } as never);
    expect(svc.getProviderUsage).toHaveBeenCalledWith({ tenantId, providerCode: 'SEGIP', days: 30 });
    await c.reports.idempotencyAudit('1', { days: 3, limit: 10 } as never);
    expect(svc.auditIdempotencyKeys).toHaveBeenCalledWith({ tenantId, days: 3, limit: 10 });
    await c.reports.retentionPreview('1', { days: 90, limit: 5 } as never);
    expect(svc.getRetentionPreview).toHaveBeenCalledWith({ tenantId, days: 90, limit: 5 });
    await c.reports.sanitizationAudit('1', { limit: 20 } as never);
    expect(svc.auditResponseSanitization).toHaveBeenCalledWith({ tenantId, limit: 20 });
  });

  it('mutaciones de runtime/costo (patchRuntime, killSwitch, getCostPolicy, updateCostPolicy)', async () => {
    const svc = service();
    const c = buildAdminControllers(svc);
    await c.config.patchRuntime({ providerCode: 'SEGIP' } as never, { mode: 'disabled' } as never);
    expect(svc.updateProviderRuntimePolicy).toHaveBeenCalledWith({ providerCode: 'SEGIP', patch: { mode: 'disabled' } });
    await c.config.killSwitch(
      { providerCode: 'SEGIP' } as never,
      { reason: 'leak' } as never,
      { role: 'risk_analyst', internalUserId: '7' } as never,
    );
    expect(svc.activateProviderKillSwitch).toHaveBeenCalledWith({ providerCode: 'SEGIP', reason: 'leak', activatedBy: '7' });
    await c.config.getCostPolicy({ providerCode: 'SEGIP' } as never);
    expect(svc.getProviderCostPolicies).toHaveBeenCalledWith('SEGIP');
    await c.config.updateCostPolicy({ providerCode: 'SEGIP' } as never, 'CREDIT_CHECK', { blockByDefault: false } as never);
    expect(svc.updateProviderCostPolicy).toHaveBeenCalledWith({
      providerCode: 'SEGIP',
      queryType: 'CREDIT_CHECK',
      patch: { blockByDefault: false },
    });
  });

  it('previewPolicy delega en el preview del servicio', async () => {
    const svc = service();
    const c = buildAdminControllers(svc);
    const body = { customerId: '9', providerCode: 'SEGIP', queryType: 'q', purpose: 'p', decisionStage: 'd', input: {} } as never;
    await c.reports.previewPolicy('1', body, user);
    expect(svc.previewExternalDataRequest).toHaveBeenCalledWith({
      tenantId,
      body,
      requestedByUserId: actorId(user),
      approvedByAdminId: undefined,
    });
  });

  it('testProvider rellena defaults sensatos cuando el body viene vacío, sin inventar cliente', async () => {
    const svc = service();
    const c = buildAdminControllers(svc);
    await c.config.testProvider('1', { providerCode: 'SEGIP' } as never, {}, user);
    expect(svc.executeExternalDataRequest).toHaveBeenCalledWith({
      tenantId,
      body: {
        providerCode: 'SEGIP',
        customerId: undefined,
        queryType: 'IDENTITY_VERIFICATION',
        purpose: 'MANUAL_REVIEW',
        decisionStage: 'MANUAL_REVIEW',
        input: {},
        scenario: undefined,
        forceRefresh: true,
      },
      requestedByUserId: actorId(user),
      approvedByAdminId: actorId(user),
      syntheticProbe: true,
    });
  });

  it('testProvider respeta los valores provistos en el body', async () => {
    const svc = service();
    const c = buildAdminControllers(svc);
    const body = {
      customerId: '42',
      queryType: 'CREDIT_CHECK',
      purpose: 'ORIGINATION',
      decisionStage: 'ORIGINATION',
      input: { doc: 'x' },
      scenario: 'happy',
    };
    await c.config.testProvider('1', { providerCode: 'INFOCENTER' } as never, body, user);
    expect(svc.executeExternalDataRequest).toHaveBeenCalledWith({
      tenantId,
      body: { providerCode: 'INFOCENTER', ...body, forceRefresh: true },
      requestedByUserId: actorId(user),
      approvedByAdminId: actorId(user),
      syntheticProbe: true,
    });
  });

  it('testProvider de un analista NO se autoaprueba: la política de costo decide', async () => {
    const svc = service();
    const c = buildAdminControllers(svc);
    const analyst = { role: 'risk_analyst', tenantId: '1', internalUserId: 'r1' } as never;
    await c.config.testProvider('1', { providerCode: 'INFOCENTER' } as never, { approvedByAdminId: 'a1' } as never, analyst);
    expect(svc.executeExternalDataRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ approvedByAdminId: undefined, requestedByUserId: 'r1' }),
    );
  });

  it('approveRequest queda siempre a nombre del actor (el approvedByAdminId del body no atribuye a otro); retry y rebuild delegan', async () => {
    const svc = service();
    const c = buildAdminControllers(svc);
    await c.requests.approveRequest('1', { requestId: '7' } as never, { approvedByAdminId: 'boss', approvalReason: 'ok' } as never, user);
    expect(svc.approveRequest).toHaveBeenCalledWith({ tenantId, requestId: '7', approvedByAdminId: actorId(user), approvalReason: 'ok' });
    await c.requests.approveRequest('1', { requestId: '8' } as never, { approvalReason: 'ok2' } as never, user);
    expect(svc.approveRequest).toHaveBeenLastCalledWith({
      tenantId,
      requestId: '8',
      approvedByAdminId: actorId(user),
      approvalReason: 'ok2',
    });
    const retryBody = { reason: 'transient' } as never;
    await c.requests.retryRequest('1', { requestId: '9' } as never, retryBody, user);
    expect(svc.retryProviderRequest).toHaveBeenCalledWith({
      tenantId,
      requestId: '9',
      body: retryBody,
      requestedByUserId: actorId(user),
      approvedByAdminId: undefined,
    });
    await c.requests.rebuildFeatures('1', { requestId: '10' } as never);
    expect(svc.rebuildFeatureSnapshotFromRequest).toHaveBeenCalledWith({ tenantId, requestId: '10' });
  });
});
