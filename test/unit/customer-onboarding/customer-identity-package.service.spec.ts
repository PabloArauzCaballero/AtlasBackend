import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerIdentityPackageService } from '../../../src/modules/customer-onboarding/application/customer-identity-package.service.js';

/**
 * ATLAS-P12d (extensión — `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, punto 5):
 * `CustomerIdentityPackageService.submitIdentityPackage` (199 líneas) — recepción del paquete
 * KYC (documento de identidad + evidencia). El caso más importante es
 * `REQUIRED_EVIDENCE_MISSING`: sin el frente del documento, no hay paquete de identidad válido,
 * sin importar qué más se haya enviado.
 */
describe('CustomerIdentityPackageService.submitIdentityPackage', () => {
  function buildService() {
    const customersRepository = { findById: jest.fn(), createStatusEvent: jest.fn() };
    const onboardingRepository = {
      createDataProviderRequest: jest.fn(),
      createDataProviderResponse: jest.fn(),
      createEvidenceDocument: jest.fn(),
      createEvidenceExtraction: jest.fn(),
      createEvidenceReview: jest.fn(),
      createIdentityDocument: jest.fn(),
      createIdentityVerificationAttempt: jest.fn(),
      findLatestOnboardingFlow: jest.fn(),
      createOnboardingStepEvent: jest.fn(),
      updateCustomerStatus: jest.fn(),
      createCustomerActionLog: jest.fn(),
      createOperationalAuditLog: jest.fn(),
    };
    // La transición de estado del cliente la aplica ahora `CustomerLifecycleService`, que
    // valida contra la máquina de estados y escribe estado + evento en la misma transacción.
    const lifecycleService = { transition: jest.fn(), advance: jest.fn() };
    // El backend ahora DESCARGA cada objeto y recalcula su hash antes de aceptar el paquete: hasta
    // esta versión guardaba la ruta y el hash que declaraba el propio cliente, sin ver el archivo.
    const storageService = {
      isConfigured: jest.fn((..._args: unknown[]) => true),
      getBucket: jest.fn((..._args: unknown[]) => 'atlas-evidence'),
      verifyDeclaredObject: jest.fn(async (..._args: unknown[]) => ({
        ok: true,
        metadata: { sizeBytes: 2048, contentType: 'image/jpeg', sha256Hex: 'v'.repeat(64) },
      })),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    // La verificación contra el proveedor vive en su propio servicio y corre FUERA de la
    // transacción, encadenada sólo si el paquete trae `documentNumber`. Se dobla porque estas
    // pruebas fijan lo que ocurre al GUARDAR el paquete; el contrato de la verificación lo fija
    // `customer-verification.service.spec.ts`.
    const providerVerificationService = {
      verifyWithProvider: jest.fn(async (..._args: unknown[]) => ({
        providerStatus: 'verified',
        identityVerificationResult: 'verified',
        requiresManualReview: false,
      })),
    };
    const service = new CustomerIdentityPackageService(
      customersRepository as never,
      onboardingRepository as never,
      lifecycleService as never,
      storageService as never,
      providerVerificationService as never,
      sequelize as never,
    );
    return { service, customersRepository, onboardingRepository, lifecycleService, storageService, providerVerificationService };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null, platformUserId: null } as never;

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: 't1',
      customerId: 'c1',
      body: {
        identity: { documentType: 'CI', documentNumberHash: 'hash1', documentLast4: '1234' },
        evidence: [{ evidenceType: 'identity_front', storageKey: 'k1', mimeType: 'image/jpeg', sha256Hash: 'h1' }],
      } as never,
      currentUser: customerUser,
      ipAddress: '10.0.0.1',
      idempotencyKey: 'idem-1',
      ...overrides,
    };
  }

  it('throws BadRequestException without an idempotency key', async () => {
    const { service } = buildService();
    await expect(service.submitIdentityPackage(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
  });

  it('throws ForbiddenException when a customer token submits for a different customerId', async () => {
    const { service } = buildService();
    await expect(service.submitIdentityPackage(baseInput({ customerId: 'someone-else' }))).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when the customer does not exist', async () => {
    const { service, customersRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.submitIdentityPackage(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('throws UnprocessableEntityException REQUIRED_EVIDENCE_MISSING when there is no "identity_front" evidence — even with other evidence present', async () => {
    const { service, customersRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
    await expect(
      service.submitIdentityPackage(
        baseInput({
          body: { identity: {}, evidence: [{ evidenceType: 'identity_back', storageKey: 'k', mimeType: 'image/jpeg', sha256Hash: 'h' }] },
        }),
      ),
    ).rejects.toThrow(/REQUIRED_EVIDENCE_MISSING/);
  });

  it('does not create a data provider request/response when no provider is specified', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
    (onboardingRepository.createEvidenceDocument as jest.Mock).mockResolvedValueOnce({ id: 'evidence-1' } as never);
    (onboardingRepository.createIdentityDocument as jest.Mock).mockResolvedValueOnce({ id: 'identity-doc-1' } as never);
    (onboardingRepository.createIdentityVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitIdentityPackage(baseInput());

    expect(onboardingRepository.createDataProviderRequest).not.toHaveBeenCalled();
  });

  it('creates a data provider request + response when a provider IS specified', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
    (onboardingRepository.createDataProviderRequest as jest.Mock).mockResolvedValueOnce({ id: 'provider-req-1' } as never);
    (onboardingRepository.createEvidenceDocument as jest.Mock).mockResolvedValueOnce({ id: 'evidence-1' } as never);
    (onboardingRepository.createIdentityDocument as jest.Mock).mockResolvedValueOnce({ id: 'identity-doc-1' } as never);
    (onboardingRepository.createIdentityVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitIdentityPackage(
      baseInput({
        body: {
          identity: {},
          evidence: [{ evidenceType: 'identity_front', storageKey: 'k', mimeType: 'image/jpeg', sha256Hash: 'h' }],
          provider: { providerCode: 'SEGIP' },
        },
      }),
    );

    expect(onboardingRepository.createDataProviderRequest).toHaveBeenCalledTimes(1);
    expect(onboardingRepository.createDataProviderResponse).toHaveBeenCalledTimes(1);
    const verificationAttemptArgs = (onboardingRepository.createIdentityVerificationAttempt as jest.Mock).mock.calls[0][0] as {
      providerRequestId: string;
    };
    expect(verificationAttemptArgs.providerRequestId).toBe('provider-req-1');
  });

  it('maps identity_front and identity_back evidence to the correct frontEvidenceId/backEvidenceId fields — not swapped', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
    (onboardingRepository.createEvidenceDocument as jest.Mock)
      .mockResolvedValueOnce({ id: 'front-evidence-id' } as never)
      .mockResolvedValueOnce({ id: 'back-evidence-id' } as never);
    (onboardingRepository.createIdentityDocument as jest.Mock).mockResolvedValueOnce({ id: 'identity-doc-1' } as never);
    (onboardingRepository.createIdentityVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitIdentityPackage(
      baseInput({
        body: {
          identity: {},
          evidence: [
            { evidenceType: 'identity_front', storageKey: 'k1', mimeType: 'image/jpeg', sha256Hash: 'h1' },
            { evidenceType: 'identity_back', storageKey: 'k2', mimeType: 'image/jpeg', sha256Hash: 'h2' },
          ],
        },
      }),
    );

    const identityDocArgs = (onboardingRepository.createIdentityDocument as jest.Mock).mock.calls[0][0] as {
      frontEvidenceId: string;
      backEvidenceId: string;
    };
    expect(identityDocArgs.frontEvidenceId).toBe('front-evidence-id');
    expect(identityDocArgs.backEvidenceId).toBe('back-evidence-id');
  });

  it('creates one evidence document + extraction + review per evidence item', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
    (onboardingRepository.createEvidenceDocument as jest.Mock)
      .mockResolvedValueOnce({ id: 'e1' } as never)
      .mockResolvedValueOnce({ id: 'e2' } as never);
    (onboardingRepository.createIdentityDocument as jest.Mock).mockResolvedValueOnce({ id: 'identity-doc-1' } as never);
    (onboardingRepository.createIdentityVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitIdentityPackage(
      baseInput({
        body: {
          identity: {},
          evidence: [
            { evidenceType: 'identity_front', storageKey: 'k1', mimeType: 'image/jpeg', sha256Hash: 'h1' },
            { evidenceType: 'identity_back', storageKey: 'k2', mimeType: 'image/jpeg', sha256Hash: 'h2' },
          ],
        },
      }),
    );

    expect(onboardingRepository.createEvidenceDocument).toHaveBeenCalledTimes(2);
    expect(onboardingRepository.createEvidenceExtraction).toHaveBeenCalledTimes(2);
    expect(onboardingRepository.createEvidenceReview).toHaveBeenCalledTimes(2);
  });

  it('every evidence extraction is created with requiresReview: true — nothing is auto-approved', async () => {
    const { service, customersRepository, onboardingRepository } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
    (onboardingRepository.createEvidenceDocument as jest.Mock).mockResolvedValueOnce({ id: 'e1' } as never);
    (onboardingRepository.createIdentityDocument as jest.Mock).mockResolvedValueOnce({ id: 'identity-doc-1' } as never);
    (onboardingRepository.createIdentityVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    await service.submitIdentityPackage(baseInput());

    const extractionArgs = (onboardingRepository.createEvidenceExtraction as jest.Mock).mock.calls[0][0] as { requiresReview: boolean };
    expect(extractionArgs.requiresReview).toBe(true);
  });

  it('delega la transición de estado en CustomerLifecycleService en vez de escribir el estado a mano', async () => {
    const { service, customersRepository, onboardingRepository, lifecycleService } = buildService();
    const customer = { id: 'c1', lifecycleStatus: 'registered' };
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce(customer as never);
    (onboardingRepository.createEvidenceDocument as jest.Mock).mockResolvedValueOnce({ id: 'e1' } as never);
    (onboardingRepository.createIdentityDocument as jest.Mock).mockResolvedValueOnce({ id: 'identity-doc-1' } as never);
    (onboardingRepository.createIdentityVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
    (onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);

    const result = await service.submitIdentityPackage(baseInput());

    // El estado ya no se escribe aquí: `pending_identity_review` era un valor que este servicio
    // producía y que ningún otro componente leía. Ahora la transición la aplica el servicio de
    // ciclo de vida, que valida contra la máquina de estados y usa el estado anterior real.
    expect(customersRepository.createStatusEvent).not.toHaveBeenCalled();
    expect(onboardingRepository.updateCustomerStatus).not.toHaveBeenCalled();
    expect(lifecycleService.advance).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'onboarding_in_progress', reasonCode: 'identity_package_submitted', transaction: {} }),
    );
    expect(result.nextStep).toBe('reference_contacts');
  });

  describe('verificación encadenada con el proveedor', () => {
    function primed() {
      const mocks = buildService();
      (mocks.customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'registered' } as never);
      (mocks.onboardingRepository.createEvidenceDocument as jest.Mock).mockResolvedValue({ id: 'evidence-1' } as never);
      (mocks.onboardingRepository.createIdentityDocument as jest.Mock).mockResolvedValueOnce({ id: 'identity-doc-1' } as never);
      (mocks.onboardingRepository.createIdentityVerificationAttempt as jest.Mock).mockResolvedValueOnce({ id: 'attempt-1' } as never);
      (mocks.onboardingRepository.findLatestOnboardingFlow as jest.Mock).mockResolvedValueOnce(null as never);
      return mocks;
    }

    function inputWithDocumentNumber() {
      const input = baseInput();
      (input.body as { identity: Record<string, unknown> }).identity.documentNumber = '1234567';
      return input;
    }

    /**
     * El encadenamiento es OPCIONAL a propósito: hay despliegues donde el número de documento no
     * debe salir del dispositivo. Sin él, el paquete se guarda igual y la verificación queda como
     * paso explícito (`POST .../identity-verification`).
     */
    it('no llama al proveedor cuando el paquete no trae el número en claro', async () => {
      const { service, providerVerificationService } = primed();
      const result = await service.submitIdentityPackage(baseInput());
      expect(providerVerificationService.verifyWithProvider).not.toHaveBeenCalled();
      expect(result.status).toBe('pending_review');
    });

    it('encadena la verificación cuando el paquete trae el número, y refleja su veredicto', async () => {
      const { service, providerVerificationService } = primed();
      (providerVerificationService.verifyWithProvider as jest.Mock).mockResolvedValueOnce({
        providerStatus: 'FOUND',
        identityVerificationResult: 'verified',
        requiresManualReview: false,
        reasonCode: 'identity_verified_by_provider',
      } as never);

      const result = await service.submitIdentityPackage(inputWithDocumentNumber());

      expect(providerVerificationService.verifyWithProvider).toHaveBeenCalledWith(
        expect.objectContaining({ body: { documentNumber: '1234567' } }),
      );
      expect(result.status).toBe('verified');
    });

    it('un veredicto negativo devuelve al cliente a la captura de documentos', async () => {
      const { service, providerVerificationService } = primed();
      (providerVerificationService.verifyWithProvider as jest.Mock).mockResolvedValueOnce({
        providerStatus: 'NOT_FOUND',
        identityVerificationResult: 'rejected',
        requiresManualReview: false,
        reasonCode: 'identity_document_not_found',
      } as never);

      const result = await service.submitIdentityPackage(inputWithDocumentNumber());

      expect(result).toMatchObject({ status: 'rejected', nextStep: 'identity_documents' });
    });

    /** Perder el paquete por una caída ajena sería peor que dejar la verificación para después. */
    it('si el proveedor falla, el paquete YA quedó guardado y la verificación se difiere', async () => {
      const { service, providerVerificationService } = primed();
      (providerVerificationService.verifyWithProvider as jest.Mock).mockRejectedValueOnce(new Error('proveedor caído') as never);

      const result = await service.submitIdentityPackage(inputWithDocumentNumber());

      expect(result).toMatchObject({ identityVerificationAttemptId: 'attempt-1', verification: { skipped: true } });
    });
  });
});
