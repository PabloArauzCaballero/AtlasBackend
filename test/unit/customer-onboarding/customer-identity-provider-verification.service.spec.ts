import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CustomerIdentityProviderVerificationService } from '../../../src/modules/customer-onboarding/application/customer-identity-provider-verification.service.js';
import { hashSensitiveText } from '../../../src/common/utils/crypto/hash.util.js';

/**
 * Verificación automática de identidad contra el proveedor externo.
 *
 * Cierra la condición C9 por la vía automática. El endpoint `POST /kyc/segip/verify` ya existía pero
 * **su resultado no llegaba a ninguna parte**: se guardaba en `data_provider_responses` y el
 * expediente del cliente seguía intacto. Este servicio es el puente que faltaba.
 */
describe('CustomerIdentityProviderVerificationService', () => {
  const DOCUMENT_NUMBER = '1234567';

  function build(providerResult: Record<string, unknown> = { status: 'FOUND', manualReviewRequired: false }) {
    const customersRepository = { findById: jest.fn(async () => ({ id: 'c1', lifecycleStatus: 'under_review' })) };
    const verificationRepository = {
      findLatestAttempt: jest.fn(async () => ({ id: 'attempt-1', finalResult: 'pending_review' })),
      findLatestIdentityDocument: jest.fn(async () => ({ id: 'doc-1', declaredNumberHash: hashSensitiveText(DOCUMENT_NUMBER) })),
      resolveAttempt: jest.fn(),
      resolveIdentityDocument: jest.fn(),
      findPendingReviews: jest.fn(async () => [{ id: 'rev-1' }]),
      resolveReview: jest.fn(),
    };
    const profileDataRepository = {
      findCurrentProfile: jest.fn(async () => ({ id: 'p1', firstName: 'Ana', lastName: 'Paz', birthDate: '1990-01-01' })),
    };
    const onboardingRepository = {
      findLatestOnboardingFlow: jest.fn(async () => ({ id: 'flow-1' })),
      createOnboardingStepEvent: jest.fn(),
      createOperationalAuditLog: jest.fn(),
    };
    const externalDataService = {
      executeSegip: jest.fn(async () => ({
        requestId: 'req-1',
        providerCode: 'SEGIP',
        reasonCode: null,
        observations: [],
        features: {},
        modeUsed: 'mock_server',
        ...providerResult,
      })),
    };
    const lifecycleService = { advance: jest.fn(), transition: jest.fn() };
    const eligibilityService = {
      evaluateAndRecord: jest.fn(async () => ({ eligible: false, blockers: [], lifecycleStatus: 'under_review', evaluatedAt: 'now' })),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new CustomerIdentityProviderVerificationService(
      customersRepository as never,
      verificationRepository as never,
      profileDataRepository as never,
      onboardingRepository as never,
      externalDataService as never,
      lifecycleService as never,
      eligibilityService as never,
      sequelize as never,
    );
    return {
      service,
      customersRepository,
      verificationRepository,
      profileDataRepository,
      onboardingRepository,
      externalDataService,
      lifecycleService,
      eligibilityService,
    };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null } as never;
  const baseInput = {
    tenantId: 't1',
    customerId: 'c1',
    body: { documentNumber: DOCUMENT_NUMBER } as never,
    currentUser: customerUser,
    ipAddress: '10.0.0.1',
    idempotencyKey: 'idem-1',
  };

  describe('guardas previas', () => {
    it('lanza NotFoundException cuando el cliente no existe', async () => {
      const { service, customersRepository } = build();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.verifyWithProvider(baseInput)).rejects.toThrow(NotFoundException);
    });

    it('exige haber enviado antes el paquete de identidad', async () => {
      const { service, verificationRepository } = build();
      (verificationRepository.findLatestAttempt as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.verifyWithProvider(baseInput)).rejects.toThrow(/IDENTITY_PACKAGE_REQUIRED/);
    });

    it('no revierte una identidad ya verificada', async () => {
      const { service, verificationRepository, externalDataService } = build();
      (verificationRepository.findLatestAttempt as jest.Mock).mockResolvedValueOnce({
        id: 'attempt-1',
        finalResult: 'verified',
      } as never);
      await expect(service.verifyWithProvider(baseInput)).rejects.toThrow(/IDENTITY_ALREADY_VERIFIED/);
      expect(externalDataService.executeSegip).not.toHaveBeenCalled();
    });

    /**
     * Sin esta comprobación se podría verificar la identidad de OTRA persona y adjuntarla al
     * expediente del cliente: el proveedor confirmaría un documento real que no es el declarado.
     */
    it('rechaza un documento que no coincide por hash con el declarado en el paquete', async () => {
      const { service, externalDataService } = build();
      await expect(service.verifyWithProvider({ ...baseInput, body: { documentNumber: '7654321' } as never })).rejects.toThrow(
        /DOCUMENT_NUMBER_MISMATCH/,
      );
      expect(externalDataService.executeSegip).not.toHaveBeenCalled();
    });

    it('exige nombre y apellido para poder consultar al registro', async () => {
      const { service, profileDataRepository } = build();
      (profileDataRepository.findCurrentProfile as jest.Mock).mockResolvedValueOnce({ id: 'p1', firstName: null } as never);
      await expect(service.verifyWithProvider(baseInput)).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('consulta al proveedor', () => {
    it('envía al proveedor los datos del perfil vigente, no los que mande el cliente', async () => {
      const { service, externalDataService } = build();
      await service.verifyWithProvider(baseInput);
      expect((externalDataService.executeSegip as jest.Mock).mock.calls[0][0]).toMatchObject({
        tenantId: 't1',
        customerId: 'c1',
        body: expect.objectContaining({ documentNumber: DOCUMENT_NUMBER, firstName: 'Ana', lastName: 'Paz', birthDate: '1990-01-01' }),
      });
    });

    it('propaga el escenario pedido para que el simulador pueda sortear el veredicto', async () => {
      const { service, externalDataService } = build();
      await service.verifyWithProvider({ ...baseInput, body: { documentNumber: DOCUMENT_NUMBER, scenario: 'random' } as never });
      const call = (externalDataService.executeSegip as jest.Mock).mock.calls[0][0] as { body: { scenario?: string } };
      expect(call.body.scenario).toBe('random');
    });
  });

  describe('aplicación del veredicto', () => {
    it('FOUND verifica el expediente y aprueba la evidencia pendiente', async () => {
      const { service, verificationRepository, lifecycleService } = build({ status: 'FOUND', manualReviewRequired: false });

      const result = await service.verifyWithProvider(baseInput);

      expect((verificationRepository.resolveAttempt as jest.Mock).mock.calls[0][1]).toMatchObject({ finalResult: 'verified' });
      expect((verificationRepository.resolveIdentityDocument as jest.Mock).mock.calls[0][2]).toMatchObject({
        verificationStatus: 'verified',
      });
      expect(verificationRepository.resolveReview).toHaveBeenCalledTimes(1);
      // Verificar la identidad NO habilita por sí solo: eso lo decide la regla completa.
      expect(lifecycleService.advance).not.toHaveBeenCalled();
      expect(result.identityVerificationResult).toBe('verified');
    });

    it('NOT_FOUND rechaza el documento y devuelve al cliente a corregir', async () => {
      const { service, verificationRepository, lifecycleService } = build({ status: 'NOT_FOUND', manualReviewRequired: true });

      const result = await service.verifyWithProvider(baseInput);

      expect((verificationRepository.resolveAttempt as jest.Mock).mock.calls[0][1]).toMatchObject({ finalResult: 'rejected' });
      expect((verificationRepository.resolveIdentityDocument as jest.Mock).mock.calls[0][2]).toMatchObject({
        verificationStatus: 'rejected',
      });
      expect(verificationRepository.resolveReview).not.toHaveBeenCalled();
      expect(lifecycleService.advance).toHaveBeenCalledWith(expect.objectContaining({ toStatus: 'observed' }));
      expect(result.identityVerificationResult).toBe('rejected');
    });

    it('PARTIAL_MATCH deja el caso pendiente sin tocar el estado del documento', async () => {
      const { service, verificationRepository, lifecycleService } = build({ status: 'PARTIAL_MATCH', manualReviewRequired: true });

      const result = await service.verifyWithProvider(baseInput);

      expect((verificationRepository.resolveAttempt as jest.Mock).mock.calls[0][1]).toMatchObject({ finalResult: 'pending_review' });
      // El documento queda como estaba: un reintento posterior sigue siendo posible.
      expect(verificationRepository.resolveIdentityDocument).not.toHaveBeenCalled();
      expect(lifecycleService.advance).not.toHaveBeenCalled();
      expect(result.requiresManualReview).toBe(true);
    });

    it('una caída del proveedor no rechaza al cliente ni cierra el documento', async () => {
      const { service, verificationRepository, lifecycleService } = build({ status: 'PROVIDER_UNAVAILABLE', reasonCode: 'SEGIP_TIMEOUT' });

      const result = await service.verifyWithProvider(baseInput);

      expect(result.identityVerificationResult).toBe('pending_review');
      expect(result.reasonCode).toBe('SEGIP_TIMEOUT');
      expect(verificationRepository.resolveIdentityDocument).not.toHaveBeenCalled();
      expect(lifecycleService.advance).not.toHaveBeenCalled();
    });
  });

  describe('trazabilidad', () => {
    it('la auditoría registra el veredicto y el request del proveedor, NUNCA el número de documento', async () => {
      const { service, onboardingRepository } = build();
      await service.verifyWithProvider(baseInput);

      const audit = (onboardingRepository.createOperationalAuditLog as jest.Mock).mock.calls[0][0];
      expect(audit).toMatchObject({
        actionCode: 'customer_onboarding.identity_verification.provider',
        payloadJson: expect.objectContaining({ providerCode: 'SEGIP', providerStatus: 'FOUND', providerRequestId: 'req-1' }),
      });
      expect(JSON.stringify(audit)).not.toContain(DOCUMENT_NUMBER);
    });

    it('deja el paso del flujo y reevalúa la elegibilidad en la misma transacción', async () => {
      const { service, onboardingRepository, eligibilityService } = build();
      await service.verifyWithProvider(baseInput);

      expect((onboardingRepository.createOnboardingStepEvent as jest.Mock).mock.calls[0][0]).toMatchObject({
        stepCode: 'identity_provider_verification',
        eventType: 'completed',
      });
      expect(eligibilityService.evaluateAndRecord).toHaveBeenCalledWith(
        expect.objectContaining({ decisionSource: 'automatic', transaction: {} }),
      );
    });
  });
});
