import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerPrivacyService } from '../../../src/modules/customer-privacy/customer-privacy.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 3): primer test real de
 * `customer-privacy` (514 líneas, 0 tests hasta este patch) — consentimientos y solicitudes de
 * datos personales (derecho de acceso/portabilidad/eliminación). Es superficie legal/regulatoria,
 * no solo lógica de app: el plazo de `dueAt` (15 días) y la transición a `requires_review` tras
 * una revocación son las dos reglas de negocio más importantes de este archivo.
 */
describe('CustomerPrivacyService', () => {
  function buildService() {
    const privacyRepository = {
      createCustomerConsent: jest.fn(),
      createConsentEvent: jest.fn(),
      createStatusEvent: jest.fn(),
      createActionLog: jest.fn(),
      createAudit: jest.fn(),
      createDataSubjectRequest: jest.fn(),
    };
    const customersRepository = { findById: jest.fn() };
    const consentsRepository = { findActiveDocumentById: jest.fn() };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new CustomerPrivacyService(
      privacyRepository as never,
      customersRepository as never,
      consentsRepository as never,
      sequelize as never,
    );
    return { service, privacyRepository, customersRepository, consentsRepository };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: 't1',
      customerId: 'c1',
      body: { decisions: [{ consentDocumentId: 'doc1', purposeCode: 'marketing', decision: 'granted' }] } as never,
      currentUser: customerUser,
      idempotencyKey: 'idem-1',
      ipAddress: '10.0.0.1',
      channel: 'mobile_app',
      ...overrides,
    };
  }

  describe('registerConsentDecisions', () => {
    it('throws BadRequestException without an idempotency key', async () => {
      const { service, customersRepository } = buildService();
      await expect(service.registerConsentDecisions(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
      expect(customersRepository.findById).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the token customer does not match the requested customerId', async () => {
      const { service } = buildService();
      await expect(service.registerConsentDecisions(baseInput({ customerId: 'someone-else' }))).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the customer does not exist', async () => {
      const { service, customersRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.registerConsentDecisions(baseInput())).rejects.toThrow(NotFoundException);
    });

    it('throws CONSENT_DOCUMENT_NOT_ACTIVE when a decision references a document that is not active', async () => {
      const { service, customersRepository, consentsRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.registerConsentDecisions(baseInput())).rejects.toThrow(/CONSENT_DOCUMENT_NOT_ACTIVE/);
    });

    it('a batch of only "granted" decisions returns currentConsentStatus "complete" and does NOT create a status event', async () => {
      const { service, customersRepository, consentsRepository, privacyRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValue({ id: 'doc1' } as never);
      (privacyRepository.createCustomerConsent as jest.Mock).mockResolvedValue({ id: 'consent-1' } as never);

      const result = await service.registerConsentDecisions(baseInput());

      expect(result.currentConsentStatus).toBe('complete');
      expect(privacyRepository.createStatusEvent).not.toHaveBeenCalled();
    });

    it('a batch containing at least one "revoked" decision returns "requires_review" and DOES create a status event', async () => {
      const { service, customersRepository, consentsRepository, privacyRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'approved_for_next_step' } as never);
      (consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValue({ id: 'doc1' } as never);
      (privacyRepository.createCustomerConsent as jest.Mock).mockResolvedValue({ id: 'consent-1' } as never);

      const result = await service.registerConsentDecisions(
        baseInput({
          body: {
            decisions: [
              { consentDocumentId: 'doc1', purposeCode: 'marketing', decision: 'granted' },
              { consentDocumentId: 'doc2', purposeCode: 'data_sharing', decision: 'revoked' },
            ],
          } as never,
        }),
      );

      expect(result.currentConsentStatus).toBe('requires_review');
      expect(privacyRepository.createStatusEvent).toHaveBeenCalledTimes(1);
      expect(result.processed).toBe(2);
    });

    it('one revoked decision among many is enough to flip hasRevoked — it is an OR across the whole batch, not per-decision', async () => {
      const { service, customersRepository, consentsRepository, privacyRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValue({ id: 'doc1' } as never);
      (privacyRepository.createCustomerConsent as jest.Mock).mockResolvedValue({ id: 'consent-1' } as never);

      await service.registerConsentDecisions(
        baseInput({
          body: {
            decisions: [
              { consentDocumentId: 'doc1', purposeCode: 'a', decision: 'granted' },
              { consentDocumentId: 'doc1', purposeCode: 'b', decision: 'granted' },
              { consentDocumentId: 'doc1', purposeCode: 'c', decision: 'revoked' },
            ],
          } as never,
        }),
      );

      expect(privacyRepository.createStatusEvent).toHaveBeenCalledTimes(1);
    });

    it('propagates the acting internal user id to the consent event and audit log — not just the role', async () => {
      const { service, customersRepository, consentsRepository, privacyRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (consentsRepository.findActiveDocumentById as jest.Mock).mockResolvedValue({ id: 'doc1' } as never);
      (privacyRepository.createCustomerConsent as jest.Mock).mockResolvedValue({ id: 'consent-1' } as never);
      const complianceUser = { role: 'compliance_analyst', customerId: undefined, internalUserId: 'iu-42', platformUserId: undefined } as never;

      await service.registerConsentDecisions(baseInput({ currentUser: complianceUser }));

      expect(privacyRepository.createConsentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'compliance_analyst', actorInternalUserId: 'iu-42' }),
        expect.anything(),
      );
      expect(privacyRepository.createAudit).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'compliance_analyst', actorInternalUserId: 'iu-42', actorPlatformUserId: null }),
        expect.anything(),
      );
    });
  });

  describe('createDataSubjectRequest', () => {
    it('throws BadRequestException without an idempotency key', async () => {
      const { service } = buildService();
      await expect(
        service.createDataSubjectRequest({
          tenantId: 't1',
          customerId: 'c1',
          body: { requestType: 'access' } as never,
          currentUser: customerUser,
          idempotencyKey: '',
          ipAddress: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the customer does not exist', async () => {
      const { service, customersRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(
        service.createDataSubjectRequest({
          tenantId: 't1',
          customerId: 'c1',
          body: { requestType: 'access' } as never,
          currentUser: customerUser,
          idempotencyKey: 'idem-1',
          ipAddress: null,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets dueAt to exactly 15 days after the request is received — the legal SLA', async () => {
      const { service, customersRepository, privacyRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (privacyRepository.createDataSubjectRequest as jest.Mock).mockResolvedValueOnce({ id: 'dsr-1' } as never);

      await service.createDataSubjectRequest({
        tenantId: 't1',
        customerId: 'c1',
        body: { requestType: 'access' } as never,
        currentUser: customerUser,
        idempotencyKey: 'idem-1',
        ipAddress: null,
      });

      const createArgs = (privacyRepository.createDataSubjectRequest as jest.Mock).mock.calls[0][0] as { requestedAt: Date; dueAt: Date };
      const diffDays = (createArgs.dueAt.getTime() - createArgs.requestedAt.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeCloseTo(15, 5);
    });

    it('happy path returns status "received" and the new request id', async () => {
      const { service, customersRepository, privacyRepository } = buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1' } as never);
      (privacyRepository.createDataSubjectRequest as jest.Mock).mockResolvedValueOnce({ id: 'dsr-1' } as never);

      const result = await service.createDataSubjectRequest({
        tenantId: 't1',
        customerId: 'c1',
        body: { requestType: 'erasure' } as never,
        currentUser: customerUser,
        idempotencyKey: 'idem-1',
        ipAddress: null,
      });

      expect(result).toEqual({ dataSubjectRequestId: 'dsr-1', status: 'received' });
    });
  });
});
