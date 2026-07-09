import { describe, expect, it, jest } from '@jest/globals';
import { CustomerOnboardingRepository } from '../../../src/modules/customer-onboarding/customer-onboarding.repository.js';

/**
 * ATLAS-P11-T06 (derisks ATLAS-P11-T12): mismo propósito que
 * `sessions-repository-facade.spec.ts` — verificar que `CustomerOnboardingRepository` (ahora una
 * fachada sobre 4 repositorios especializados) delega en el sub-repositorio correcto con los
 * argumentos exactos, sin reescribir los tests de lógica de negocio de cada sub-repositorio.
 */
describe('CustomerOnboardingRepository (facade)', () => {
  function buildFacade() {
    const flowRepository = {
      createOnboardingFlow: jest.fn(),
      createOperationalAuditLog: jest.fn(),
      createAuthEvent: jest.fn(),
    };
    const contactVerificationRepository = {
      findCustomerContactMethod: jest.fn(),
      markContactMethodVerified: jest.fn(),
    };
    const identityEvidenceRepository = {
      createIdentityDocument: jest.fn(),
      createDataProviderRequest: jest.fn(),
    };
    const addressStatusRepository = {
      findCurrentAddress: jest.fn(),
      updateCustomerStatus: jest.fn(),
    };

    const facade = new CustomerOnboardingRepository(
      flowRepository as never,
      contactVerificationRepository as never,
      identityEvidenceRepository as never,
      addressStatusRepository as never,
    );

    return { facade, flowRepository, contactVerificationRepository, identityEvidenceRepository, addressStatusRepository };
  }

  it('delegates flow/audit methods to CustomerOnboardingFlowRepository', async () => {
    const { facade, flowRepository } = buildFacade();
    const values = {
      tenantId: 't1',
      customerId: 'c1',
      sessionId: 's1',
      flowVersion: 'v1',
      startedAt: new Date('2026-01-01'),
      completionStatus: 'in_progress',
    };
    await facade.createOnboardingFlow(values, {});
    expect(flowRepository.createOnboardingFlow).toHaveBeenCalledWith(values, {});
  });

  it('delegates contact verification methods to CustomerContactVerificationRepository, not elsewhere', async () => {
    const { facade, contactVerificationRepository, identityEvidenceRepository } = buildFacade();
    await facade.findCustomerContactMethod('t1', 'c1', 'phone', {});
    expect(contactVerificationRepository.findCustomerContactMethod).toHaveBeenCalledWith('t1', 'c1', 'phone', {});
    expect(identityEvidenceRepository.createIdentityDocument).not.toHaveBeenCalled();
  });

  it('delegates identity/evidence methods to CustomerIdentityEvidenceRepository', async () => {
    const { facade, identityEvidenceRepository } = buildFacade();
    const values = {
      tenantId: 't1',
      customerId: 'c1',
      requestType: 'kyc_check',
      providerRequestRef: null,
      requestPayloadHash: null,
      idempotencyKey: null,
      requestedAt: new Date('2026-01-01'),
    };
    await facade.createDataProviderRequest(values, {});
    expect(identityEvidenceRepository.createDataProviderRequest).toHaveBeenCalledWith(values, {});
  });

  it('delegates address/status methods to CustomerAddressStatusRepository', async () => {
    const { facade, addressStatusRepository } = buildFacade();
    await facade.findCurrentAddress('t1', 'c1', 'home', {});
    expect(addressStatusRepository.findCurrentAddress).toHaveBeenCalledWith('t1', 'c1', 'home', {});
  });

  it('propagates the return value from the delegated call unchanged', async () => {
    const { facade, addressStatusRepository } = buildFacade();
    const expected = { id: 'customer-1', lifecycleStatus: 'approved_for_next_step' };
    (addressStatusRepository.updateCustomerStatus as jest.Mock).mockResolvedValueOnce(expected as never);
    const result = await facade.updateCustomerStatus({ id: 'customer-1' } as never, 'approved_for_next_step', new Date('2026-01-01'), {});
    expect(result).toEqual(expected);
  });
});
