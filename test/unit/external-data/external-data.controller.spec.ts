import { describe, expect, it, jest } from '@jest/globals';
import { ExternalDataController, AdminExternalProvidersController } from '../../../src/modules/external-data/external-data.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';
import { actorId, customerScopeForConsentMutation } from '../../../src/modules/external-data/external-data-controller.util.js';

/**
 * Controllers principales de external-data: el de ejecución (`external-data`) y el de administración
 * (`admin/external-providers`). Ambos son wiring fino sobre `ExternalDataService`; el spec mockea el
 * servicio y verifica la resolución de tenant, el guard de acceso del cliente, el actorId y el
 * passthrough de params/query/body. Cubre los 29 endpoints (function coverage) + la rama forbidden.
 */
describe('ExternalDataController (ejecución)', () => {
  const user = { role: 'risk_analyst', tenantId: '1', internalUserId: 'u1' } as never;
  const tenantId = tenantIdFromHeader('1', user);

  function service() {
    return {
      createConsent: jest.fn(async () => ({ id: 'c' })),
      listCustomerConsents: jest.fn(async () => []),
      revokeConsent: jest.fn(async () => ({})),
      previewExternalDataRequest: jest.fn(async () => ({ wouldExecute: true })),
      executeExternalDataRequest: jest.fn(async () => ({ status: 'COMPLETED' })),
      getProviderRequest: jest.fn(async () => ({})),
      getProviderHealth: jest.fn(async () => []),
      getCustomerFeatures: jest.fn(async () => ({})),
      getCustomerScoringInput: jest.fn(async () => ({})),
      getCustomerDecisionPackage: jest.fn(async () => ({})),
      getCustomerObservations: jest.fn(async () => []),
    };
  }

  it('createConsent verifica acceso y delega con ip/user-agent', async () => {
    const svc = service();
    const c = new ExternalDataController(svc as never);
    const body = { customerId: '9', providerCode: 'SEGIP' } as never;
    await c.createConsent('1', '1.2.3.4', 'agent', body, user);
    expect(svc.createConsent).toHaveBeenCalledWith({ tenantId, body, ipAddress: '1.2.3.4', userAgent: 'agent' });
  });

  it('listConsents y revokeConsent (revoke usa el scope de mutación del actor)', async () => {
    const svc = service();
    const c = new ExternalDataController(svc as never);
    await c.listConsents('1', { customerId: '9' } as never, user);
    expect(svc.listCustomerConsents).toHaveBeenCalledWith({ tenantId, customerId: '9' });
    await c.revokeConsent('1', { consentId: '5' } as never, user);
    expect(svc.revokeConsent).toHaveBeenCalledWith({ tenantId, consentId: '5', customerId: customerScopeForConsentMutation(user) });
  });

  it('previewRequest y executeRequest delegan con requestedByUserId/idempotencyKey', async () => {
    const svc = service();
    const c = new ExternalDataController(svc as never);
    const body = { customerId: '9', providerCode: 'SEGIP', queryType: 'q', purpose: 'p', decisionStage: 'd', input: {} } as never;
    await c.previewRequest('1', body, user);
    expect(svc.previewExternalDataRequest).toHaveBeenCalledWith({ tenantId, body, requestedByUserId: actorId(user) });
    await c.executeRequest('1', 'idem-1', body, user);
    expect(svc.executeExternalDataRequest).toHaveBeenCalledWith({ tenantId, body, idempotencyKey: 'idem-1', requestedByUserId: actorId(user) });
  });

  it('lecturas por cliente y por request (features, scoring-input, decision-package, observations, getRequest, health)', async () => {
    const svc = service();
    const c = new ExternalDataController(svc as never);
    await c.getRequest('1', { requestId: '7' } as never, user);
    expect(svc.getProviderRequest).toHaveBeenCalledWith({ tenantId, requestId: '7' });
    await c.getProviderHealth('SEGIP');
    expect(svc.getProviderHealth).toHaveBeenCalledWith('SEGIP');
    await c.getUserFeatures('1', { customerId: '9' } as never, user);
    expect(svc.getCustomerFeatures).toHaveBeenCalledWith({ tenantId, customerId: '9' });
    await c.getUserScoringInput('1', { customerId: '9' } as never, user);
    expect(svc.getCustomerScoringInput).toHaveBeenCalledWith({ tenantId, customerId: '9' });
    await c.getDecisionPackage('1', { customerId: '9' } as never, { includeRawResponses: true, featureMaxAgeHours: 24 } as never, user);
    expect(svc.getCustomerDecisionPackage).toHaveBeenCalledWith({ tenantId, customerId: '9', includeRawResponses: true, featureMaxAgeHours: 24 });
    await c.getUserObservations('1', { customerId: '9' } as never, user);
    expect(svc.getCustomerObservations).toHaveBeenCalledWith({ tenantId, customerId: '9' });
  });

  it('bloquea a un customer que consulta datos de otro cliente', () => {
    const svc = service();
    const c = new ExternalDataController(svc as never);
    const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
    expect(() => c.getUserFeatures('1', { customerId: '99' } as never, customer)).toThrow();
    expect(svc.getCustomerFeatures).not.toHaveBeenCalled();
  });
});

describe('AdminExternalProvidersController (administración)', () => {
  const user = { role: 'admin', tenantId: '1', internalUserId: 'a1' } as never;
  const tenantId = tenantIdFromHeader('1', user);

  function service() {
    return {
      listProviders: jest.fn(async () => []),
      getProviderHealth: jest.fn(async () => []),
      getProviderReadiness: jest.fn(async () => ({})),
      auditExternalProvidersQuality: jest.fn(async () => ([])),
      getProductionGate: jest.fn(async () => ({})),
      getProviderSlaReport: jest.fn(async () => ({})),
      getProviderUsage: jest.fn(async () => ({})),
      auditIdempotencyKeys: jest.fn(async () => ([])),
      getRetentionPreview: jest.fn(async () => ({})),
      auditResponseSanitization: jest.fn(async () => ([])),
      previewExternalDataRequest: jest.fn(async () => ({})),
      updateProviderRuntimePolicy: jest.fn(async () => ({})),
      activateProviderKillSwitch: jest.fn(async () => ({})),
      getProviderCostPolicies: jest.fn(async () => ([])),
      updateProviderCostPolicy: jest.fn(async () => ({})),
      executeExternalDataRequest: jest.fn(async () => ({})),
      approveRequest: jest.fn(async () => ({})),
      retryProviderRequest: jest.fn(async () => ({})),
      rebuildFeatureSnapshotFromRequest: jest.fn(async () => ({})),
    };
  }

  it('lecturas sin argumentos (providers, health, readiness, quality-audit)', async () => {
    const svc = service();
    const c = new AdminExternalProvidersController(svc as never);
    await c.listProviders();
    await c.health();
    await c.readiness();
    await c.qualityAudit();
    expect(svc.listProviders).toHaveBeenCalled();
    expect(svc.getProviderHealth).toHaveBeenCalledWith();
    expect(svc.getProviderReadiness).toHaveBeenCalled();
    expect(svc.auditExternalProvidersQuality).toHaveBeenCalled();
  });

  it('reportes con tenant/filtros (production-gate, sla, usage, idempotency, retention, sanitization)', async () => {
    const svc = service();
    const c = new AdminExternalProvidersController(svc as never);
    await c.productionGate({ providerCode: 'SEGIP', strict: true } as never);
    expect(svc.getProductionGate).toHaveBeenCalledWith({ providerCode: 'SEGIP', strict: true });
    await c.sla('1', { providerCode: 'SEGIP', days: 7 } as never, user);
    expect(svc.getProviderSlaReport).toHaveBeenCalledWith({ tenantId, providerCode: 'SEGIP', days: 7 });
    await c.usage('1', { providerCode: 'SEGIP', days: 30 } as never, user);
    expect(svc.getProviderUsage).toHaveBeenCalledWith({ tenantId, providerCode: 'SEGIP', days: 30 });
    await c.idempotencyAudit('1', { days: 3, limit: 10 } as never, user);
    expect(svc.auditIdempotencyKeys).toHaveBeenCalledWith({ tenantId, days: 3, limit: 10 });
    await c.retentionPreview({ days: 90, limit: 5 } as never);
    expect(svc.getRetentionPreview).toHaveBeenCalledWith({ days: 90, limit: 5 });
    await c.sanitizationAudit({ limit: 20 } as never);
    expect(svc.auditResponseSanitization).toHaveBeenCalledWith({ limit: 20 });
  });

  it('mutaciones de runtime/costo (patchRuntime, killSwitch, getCostPolicy, updateCostPolicy)', async () => {
    const svc = service();
    const c = new AdminExternalProvidersController(svc as never);
    await c.patchRuntime({ providerCode: 'SEGIP' } as never, { mode: 'disabled' } as never);
    expect(svc.updateProviderRuntimePolicy).toHaveBeenCalledWith({ providerCode: 'SEGIP', patch: { mode: 'disabled' } });
    await c.killSwitch({ providerCode: 'SEGIP' } as never, { reason: 'leak' } as never);
    expect(svc.activateProviderKillSwitch).toHaveBeenCalledWith({ providerCode: 'SEGIP', reason: 'leak' });
    await c.getCostPolicy({ providerCode: 'SEGIP' } as never);
    expect(svc.getProviderCostPolicies).toHaveBeenCalledWith('SEGIP');
    await c.updateCostPolicy({ providerCode: 'SEGIP' } as never, 'CREDIT_CHECK', { blockByDefault: false } as never);
    expect(svc.updateProviderCostPolicy).toHaveBeenCalledWith({ providerCode: 'SEGIP', queryType: 'CREDIT_CHECK', patch: { blockByDefault: false } });
  });

  it('previewPolicy delega en el preview del servicio', async () => {
    const svc = service();
    const c = new AdminExternalProvidersController(svc as never);
    const body = { customerId: '9', providerCode: 'SEGIP', queryType: 'q', purpose: 'p', decisionStage: 'd', input: {} } as never;
    await c.previewPolicy('1', body, user);
    expect(svc.previewExternalDataRequest).toHaveBeenCalledWith({ tenantId, body, requestedByUserId: actorId(user) });
  });

  it('testProvider rellena defaults sensatos cuando el body viene vacío', async () => {
    const svc = service();
    const c = new AdminExternalProvidersController(svc as never);
    await c.testProvider('1', { providerCode: 'SEGIP' } as never, {}, user);
    expect(svc.executeExternalDataRequest).toHaveBeenCalledWith({
      tenantId,
      body: {
        providerCode: 'SEGIP',
        customerId: '1',
        queryType: 'IDENTITY_VERIFICATION',
        purpose: 'MANUAL_REVIEW',
        decisionStage: 'MANUAL_REVIEW',
        input: {},
        scenario: undefined,
        approvedByAdminId: actorId(user),
      },
      requestedByUserId: actorId(user),
    });
  });

  it('testProvider respeta los valores provistos en el body', async () => {
    const svc = service();
    const c = new AdminExternalProvidersController(svc as never);
    const body = { customerId: '42', queryType: 'CREDIT_CHECK', purpose: 'ORIGINATION', decisionStage: 'ORIGINATION', input: { doc: 'x' }, scenario: 'happy' };
    await c.testProvider('1', { providerCode: 'INFOCENTER' } as never, body, user);
    expect(svc.executeExternalDataRequest).toHaveBeenCalledWith({
      tenantId,
      body: { providerCode: 'INFOCENTER', ...body, approvedByAdminId: actorId(user) },
      requestedByUserId: actorId(user),
    });
  });

  it('approveRequest usa el approvedByAdminId del body o cae al actor; retry y rebuild delegan', async () => {
    const svc = service();
    const c = new AdminExternalProvidersController(svc as never);
    await c.approveRequest('1', { requestId: '7' } as never, { approvedByAdminId: 'boss', approvalReason: 'ok' } as never, user);
    expect(svc.approveRequest).toHaveBeenCalledWith({ tenantId, requestId: '7', approvedByAdminId: 'boss', approvalReason: 'ok' });
    await c.approveRequest('1', { requestId: '8' } as never, { approvalReason: 'ok2' } as never, user);
    expect(svc.approveRequest).toHaveBeenLastCalledWith({ tenantId, requestId: '8', approvedByAdminId: actorId(user), approvalReason: 'ok2' });
    const retryBody = { reason: 'transient' } as never;
    await c.retryRequest('1', { requestId: '9' } as never, retryBody, user);
    expect(svc.retryProviderRequest).toHaveBeenCalledWith({ tenantId, requestId: '9', body: retryBody, requestedByUserId: actorId(user) });
    await c.rebuildFeatures('1', { requestId: '10' } as never, user);
    expect(svc.rebuildFeatureSnapshotFromRequest).toHaveBeenCalledWith({ tenantId, requestId: '10' });
  });
});
