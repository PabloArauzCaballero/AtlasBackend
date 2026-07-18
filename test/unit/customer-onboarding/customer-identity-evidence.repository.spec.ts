import { describe, expect, it, jest } from '@jest/globals';
import { CustomerIdentityEvidenceRepository } from '../../../src/modules/customer-onboarding/repositories/customer-identity-evidence.repository.js';

/**
 * Cobertura directa de `CustomerIdentityEvidenceRepository` (Fase 1.2 del plan 10/10): documento de
 * identidad, evidencia (documento/extracción/revisión) y llamadas/respuestas a proveedores externos.
 * Todos los métodos son `create*` con mapeo y defaults fijos. Modelos Sequelize mockeados.
 */
describe('CustomerIdentityEvidenceRepository', () => {
  function buildRepo() {
    const make = () => ({ create: jest.fn() });
    const models = {
      identityDocument: make(),
      identityAttempt: make(),
      evidenceDocument: make(),
      evidenceExtraction: make(),
      evidenceReview: make(),
      providerRequest: make(),
      providerResponse: make(),
    };
    const repo = new CustomerIdentityEvidenceRepository(
      models.identityDocument as never,
      models.identityAttempt as never,
      models.evidenceDocument as never,
      models.evidenceExtraction as never,
      models.evidenceReview as never,
      models.providerRequest as never,
      models.providerResponse as never,
    );
    return { repo, models };
  }

  const opts = { transaction: 'tx' as never };
  const now = new Date('2026-01-10');

  it('createEvidenceDocument mapea storageKey→s3Key, sha256→fileHashSha256 y nace uploaded/no borrado', async () => {
    const { repo, models } = buildRepo();
    (models.evidenceDocument.create as jest.Mock).mockResolvedValue({ id: 'e1' } as never);
    await repo.createEvidenceDocument(
      {
        tenantId: 't1',
        customerId: 'c1',
        documentType: 'id_card',
        storageKey: 'k',
        mimeType: 'image/png',
        sha256Hash: 'h',
        fileSizeBytes: '100',
        sessionId: 's1',
        ipAddress: '1.2.3.4',
        uploadedAt: now,
      },
      opts,
    );
    expect((models.evidenceDocument.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      s3Key: 'k',
      fileHashSha256: 'h',
      status: 'uploaded',
      deleted: false,
      uploadedFromSessionId: 's1',
      createdAtValue: now,
    });
  });

  it('createEvidenceExtraction usa method not_executed y espeja extractedDataJson en el campo redactado', async () => {
    const { repo, models } = buildRepo();
    (models.evidenceExtraction.create as jest.Mock).mockResolvedValue({ id: 'x1' } as never);
    const extractedDataJson = { name: 'X' };
    await repo.createEvidenceExtraction({ tenantId: 't1', evidenceDocumentId: 'e1', extractedAt: now, requiresReview: true, extractedDataJson }, opts);
    expect((models.evidenceExtraction.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      extractionMethod: 'not_executed',
      extractedDataJson,
      redactedExtractedDataJson: extractedDataJson,
      requiresReview: true,
    });
  });

  it('createEvidenceReview fija reviewedBy null y createdAtValue=reviewedAt', async () => {
    const { repo, models } = buildRepo();
    (models.evidenceReview.create as jest.Mock).mockResolvedValue({ id: 'r1' } as never);
    await repo.createEvidenceReview({ tenantId: 't1', evidenceDocumentId: 'e1', reviewStatus: 'approved', reviewedAt: now, notes: null }, opts);
    expect((models.evidenceReview.create as jest.Mock).mock.calls[0][0]).toMatchObject({ reviewedBy: null, reviewStatus: 'approved', createdAtValue: now });
  });

  it('createIdentityDocument nace pending_review con validFrom=createdAt', async () => {
    const { repo, models } = buildRepo();
    (models.identityDocument.create as jest.Mock).mockResolvedValue({ id: 'd1' } as never);
    await repo.createIdentityDocument(
      {
        tenantId: 't1',
        customerId: 'c1',
        documentType: 'id_card',
        numberHash: 'nh',
        numberLast4: '1234',
        issuedIn: 'LP',
        issuedAt: '2020-01-01',
        expiresAt: '2030-01-01',
        frontEvidenceId: 'f1',
        backEvidenceId: 'b1',
        createdAt: now,
      },
      opts,
    );
    expect((models.identityDocument.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      declaredNumberHash: 'nh',
      declaredNumberLast4: '1234',
      verificationStatus: 'pending_review',
      validFrom: now,
      validUntil: null,
    });
  });

  it('createIdentityVerificationAttempt fija completedAt null y createdAtValue=requestedAt', async () => {
    const { repo, models } = buildRepo();
    (models.identityAttempt.create as jest.Mock).mockResolvedValue({ id: 'a1' } as never);
    await repo.createIdentityVerificationAttempt(
      {
        tenantId: 't1',
        customerId: 'c1',
        identityDocumentId: 'd1',
        providerRequestId: null,
        consentId: null,
        verificationChannel: 'auto',
        finalResult: 'pending',
        reasonCodesJson: null,
        requestedAt: now,
      },
      opts,
    );
    expect((models.identityAttempt.create as jest.Mock).mock.calls[0][0]).toMatchObject({ completedAt: null, createdAtValue: now });
  });

  it('createDataProviderRequest nace responseStatus not_sent', async () => {
    const { repo, models } = buildRepo();
    (models.providerRequest.create as jest.Mock).mockResolvedValue({ id: 'pr1' } as never);
    await repo.createDataProviderRequest(
      { tenantId: 't1', customerId: 'c1', requestType: 'kyc', providerRequestRef: null, requestPayloadHash: null, idempotencyKey: null, requestedAt: now },
      opts,
    );
    expect((models.providerRequest.create as jest.Mock).mock.calls[0][0]).toMatchObject({ responseStatus: 'not_sent', respondedAt: null });
  });

  it('createDataProviderResponse usa estrategia inline_redacted y espeja normalizedPayloadJson', async () => {
    const { repo, models } = buildRepo();
    (models.providerResponse.create as jest.Mock).mockResolvedValue({ id: 'pres1' } as never);
    const normalizedPayloadJson = { ok: true };
    await repo.createDataProviderResponse({ tenantId: 't1', providerRequestId: 'pr1', responseHash: 'rh', normalizedPayloadJson, createdAt: now }, opts);
    expect((models.providerResponse.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      payloadStorageStrategy: 'inline_redacted',
      redactedPayloadJson: normalizedPayloadJson,
      normalizedPayloadJson,
      containsSensitiveData: false,
    });
  });
});
