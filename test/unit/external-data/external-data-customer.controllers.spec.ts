import { describe, expect, it, jest } from '@jest/globals';
import { ExternalDataConsentsController } from '../../../src/modules/external-data/controllers/external-data-consents.controller.js';
import { ExternalDataCustomerEvidenceController } from '../../../src/modules/external-data/controllers/external-data-customer-evidence.controller.js';
import { ExternalDataRequestsController } from '../../../src/modules/external-data/controllers/external-data-requests.controller.js';
import { tenantIdFromHeader } from '../../../src/common/utils/http/headers.util.js';
import { actorId, customerScopeForConsentMutation } from '../../../src/modules/external-data/external-data-controller.util.js';

/**
 * Controllers de cliente/operación de `external-data` (consentimientos, solicitudes y evidencia por
 * cliente). Son wiring fino sobre los servicios de aplicación; el spec inyecta UN mock con los
 * métodos de todos en cada posición del constructor y verifica la resolución de tenant, el guard de
 * acceso del cliente, el actorId y el passthrough de params/query/body.
 */
function buildCustomerControllers(svc: unknown) {
  const s = svc as never;
  return {
    consents: new ExternalDataConsentsController(s),
    // orden del constructor: preview, execution, evidence, registry
    requests: new ExternalDataRequestsController(s, s, s, s),
    evidence: new ExternalDataCustomerEvidenceController(s),
  };
}

describe('Controllers de external-data para cliente y operación (consentimientos, solicitudes, evidencia)', () => {
  const user = { role: 'risk_analyst', tenantId: '1', internalUserId: 'u1' } as never;
  const tenantId = tenantIdFromHeader('1', user);

  function service() {
    return {
      createConsent: jest.fn(async (..._args: unknown[]) => ({ id: 'c' })),
      listCustomerConsents: jest.fn(async (..._args: unknown[]) => []),
      revokeConsent: jest.fn(async (..._args: unknown[]) => ({})),
      previewExternalDataRequest: jest.fn(async (..._args: unknown[]) => ({ wouldExecute: true })),
      executeExternalDataRequest: jest.fn(async (..._args: unknown[]) => ({ status: 'COMPLETED' })),
      getProviderRequest: jest.fn(async (..._args: unknown[]) => ({})),
      getProviderHealth: jest.fn(async (..._args: unknown[]) => []),
      getCustomerFeatures: jest.fn(async (..._args: unknown[]) => ({})),
      getCustomerScoringInput: jest.fn(async (..._args: unknown[]) => ({})),
      getCustomerDecisionPackage: jest.fn(async (..._args: unknown[]) => ({})),
      getCustomerObservations: jest.fn(async (..._args: unknown[]) => []),
    };
  }

  it('createConsent verifica acceso y delega con ip/user-agent', async () => {
    const svc = service();
    const c = buildCustomerControllers(svc);
    const body = { customerId: '9', providerCode: 'SEGIP' } as never;
    await c.consents.createConsent('1', '1.2.3.4', 'agent', body, user);
    expect(svc.createConsent).toHaveBeenCalledWith({
      tenantId,
      body,
      ipAddress: '1.2.3.4',
      userAgent: 'agent',
      assistedByUserId: 'u1',
    });
    await c.consents.createConsent(
      '1',
      '1.2.3.4',
      'agent',
      { customerId: '9' } as never,
      { role: 'customer', customerId: '9', sub: 's' } as never,
    );
    expect((svc.createConsent.mock.calls[1][0] as { assistedByUserId?: string }).assistedByUserId).toBeUndefined();
  });

  it('listConsents y revokeConsent (revoke usa el scope de mutación del actor)', async () => {
    const svc = service();
    const c = buildCustomerControllers(svc);
    await c.consents.listConsents('1', { customerId: '9' } as never, user);
    expect(svc.listCustomerConsents).toHaveBeenCalledWith({ tenantId, customerId: '9' });
    await c.consents.revokeConsent('1', { consentId: '5' } as never, user);
    expect(svc.revokeConsent).toHaveBeenCalledWith({ tenantId, consentId: '5', customerId: customerScopeForConsentMutation(user) });
  });

  it('previewRequest y executeRequest delegan con requestedByUserId/idempotencyKey', async () => {
    const svc = service();
    const c = buildCustomerControllers(svc);
    const body = { customerId: '9', providerCode: 'SEGIP', queryType: 'q', purpose: 'p', decisionStage: 'd', input: {} } as never;
    await c.requests.previewRequest('1', body, user);
    expect(svc.previewExternalDataRequest).toHaveBeenCalledWith({
      tenantId,
      body,
      requestedByUserId: actorId(user),
      approvedByAdminId: undefined,
    });
    await c.requests.executeRequest('1', 'idem-1', body, user);
    expect(svc.executeExternalDataRequest).toHaveBeenCalledWith({
      tenantId,
      body,
      idempotencyKey: 'idem-1',
      requestedByUserId: actorId(user),
      approvedByAdminId: undefined,
    });
  });

  it('approvedByAdminId del cuerpo: un cliente o un analista no se autoaprueban; un admin aprueba a SU nombre', async () => {
    const svc = service();
    const c = buildCustomerControllers(svc);
    const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
    const body = { customerId: '9', providerCode: 'INFOCENTER', queryType: 'CREDIT_REPORT', approvedByAdminId: '1' } as never;
    await c.requests.executeRequest('1', undefined, body, customer);
    expect(svc.executeExternalDataRequest).toHaveBeenLastCalledWith(expect.objectContaining({ approvedByAdminId: undefined }));
    await c.requests.executeRequest('1', undefined, body, user);
    expect(svc.executeExternalDataRequest).toHaveBeenLastCalledWith(expect.objectContaining({ approvedByAdminId: undefined }));
    const admin = { role: 'admin', tenantId: '1', internalUserId: 'a9' } as never;
    await c.requests.executeRequest('1', undefined, body, admin);
    expect(svc.executeExternalDataRequest).toHaveBeenLastCalledWith(expect.objectContaining({ approvedByAdminId: 'a9' }));
    await c.requests.previewRequest('1', body, customer);
    expect(svc.previewExternalDataRequest).toHaveBeenLastCalledWith(expect.objectContaining({ approvedByAdminId: undefined }));
  });

  it('lecturas por cliente y por request (features, scoring-input, decision-package, observations, getRequest, health)', async () => {
    const svc = service();
    const c = buildCustomerControllers(svc);
    await c.requests.getRequest('1', { requestId: '7' } as never, user);
    expect(svc.getProviderRequest).toHaveBeenCalledWith({ tenantId, requestId: '7', customerId: undefined });
    await c.requests.getProviderHealth('SEGIP');
    expect(svc.getProviderHealth).toHaveBeenCalledWith('SEGIP');
    await c.evidence.getUserFeatures('1', { customerId: '9' } as never, user);
    expect(svc.getCustomerFeatures).toHaveBeenCalledWith({ tenantId, customerId: '9' });
    await c.evidence.getUserScoringInput('1', { customerId: '9' } as never, user);
    expect(svc.getCustomerScoringInput).toHaveBeenCalledWith({ tenantId, customerId: '9' });
    await c.evidence.getDecisionPackage(
      '1',
      { customerId: '9' } as never,
      { includeRawResponses: true, featureMaxAgeHours: 24 } as never,
      user,
    );
    expect(svc.getCustomerDecisionPackage).toHaveBeenCalledWith({
      tenantId,
      customerId: '9',
      includeRawResponses: true,
      featureMaxAgeHours: 24,
    });
    await c.evidence.getUserObservations('1', { customerId: '9' } as never, user);
    expect(svc.getCustomerObservations).toHaveBeenCalledWith({ tenantId, customerId: '9' });
  });

  it('getRequest de un customer va acotado a su propio customerId', async () => {
    const svc = service();
    const c = buildCustomerControllers(svc);
    const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
    await c.requests.getRequest('1', { requestId: '7' } as never, customer);
    expect(svc.getProviderRequest).toHaveBeenCalledWith({ tenantId: tenantIdFromHeader('1', customer), requestId: '7', customerId: '9' });
  });

  it('bloquea a un customer que consulta datos de otro cliente', () => {
    const svc = service();
    const c = buildCustomerControllers(svc);
    const customer = { role: 'customer', tenantId: '1', customerId: '9' } as never;
    expect(() => c.evidence.getUserFeatures('1', { customerId: '99' } as never, customer)).toThrow();
    expect(svc.getCustomerFeatures).not.toHaveBeenCalled();
  });
});
