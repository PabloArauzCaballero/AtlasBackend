import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { CustomerComplianceScreeningService } from '../../../src/modules/customer-onboarding/application/customer-compliance-screening.service.js';
import { CustomerVerificationService } from '../../../src/modules/customer-onboarding/application/customer-verification.service.js';

/**
 * Resolución de identidad (C9/C10) y screening de cumplimiento (C13).
 *
 * Estas tres condiciones eran el techo real del flujo: `identity_verification_attempts` y
 * `evidence_reviews` se creaban en `pending_review` sin camino de salida, y `watchlist_entries`
 * jamás se consultaba. Ningún cliente podía llegar a ser elegible por más completo que estuviera
 * su expediente.
 */
function commonMocks() {
  const customersRepository = { findById: jest.fn(async () => ({ id: 'c1', lifecycleStatus: 'under_review' })) };
  const onboardingRepository = { createOperationalAuditLog: jest.fn() };
  const lifecycleService = { advance: jest.fn(), transition: jest.fn() };
  const eligibilityService = {
    evaluateAndRecord: jest.fn(async () => ({ eligible: true, blockers: [], lifecycleStatus: 'active', evaluatedAt: 'now' })),
  };
  const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
  return { customersRepository, onboardingRepository, lifecycleService, eligibilityService, sequelize };
}

const analyst = { role: 'risk_analyst', internalUserId: 'iu1', customerId: undefined } as never;

describe('CustomerVerificationService', () => {
  function build() {
    const common = commonMocks();
    const verificationRepository = {
      findLatestAttempt: jest.fn(async () => ({ id: 'attempt-1' })),
      resolveAttempt: jest.fn(),
      resolveIdentityDocument: jest.fn(),
      findPendingReviews: jest.fn(async () => [{ id: 'rev-1' }, { id: 'rev-2' }]),
      resolveReview: jest.fn(),
    };
    const service = new CustomerVerificationService(
      common.customersRepository as never,
      verificationRepository as never,
      common.onboardingRepository as never,
      common.lifecycleService as never,
      common.eligibilityService as never,
      common.sequelize as never,
    );
    return { service, verificationRepository, ...common };
  }

  const baseInput = { tenantId: 't1', customerId: 'c1', currentUser: analyst, ipAddress: '10.0.0.1' };

  it('lanza NotFoundException si no hay intento de verificación que resolver', async () => {
    const { service, verificationRepository } = build();
    (verificationRepository.findLatestAttempt as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.decideIdentity({ ...baseInput, body: { decision: 'approve', reasonCode: 'ok' } as never })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('aprobar resuelve intento, documento y TODAS las evidencias pendientes en bloque', async () => {
    const { service, verificationRepository } = build();

    const result = await service.decideIdentity({ ...baseInput, body: { decision: 'approve', reasonCode: 'kyc_ok' } as never });

    expect((verificationRepository.resolveAttempt as jest.Mock).mock.calls[0][1]).toMatchObject({ finalResult: 'verified' });
    expect((verificationRepository.resolveIdentityDocument as jest.Mock).mock.calls[0][2]).toMatchObject({
      verificationStatus: 'verified',
    });
    expect(verificationRepository.resolveReview).toHaveBeenCalledTimes(2);
    expect(result.resolvedEvidenceReviews).toBe(2);
  });

  /** Aprobar la identidad no habilita: la habilitación sigue dependiendo de las quince condiciones. */
  it('aprobar NO cambia el estado del cliente por sí solo, pero sí reevalúa la elegibilidad', async () => {
    const { service, lifecycleService, eligibilityService } = build();

    const result = await service.decideIdentity({ ...baseInput, body: { decision: 'approve', reasonCode: 'kyc_ok' } as never });

    expect(lifecycleService.advance).not.toHaveBeenCalled();
    expect(eligibilityService.evaluateAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({ decisionSource: 'manual_decision', reasonCode: 'kyc_ok' }),
    );
    expect(result.eligible).toBe(true);
  });

  it('rechazar devuelve al cliente a corregir y marca la evidencia como rechazada', async () => {
    const { service, lifecycleService, verificationRepository } = build();

    const result = await service.decideIdentity({
      ...baseInput,
      body: { decision: 'reject', reasonCode: 'document_illegible', notes: 'Foto borrosa.' } as never,
    });

    expect(lifecycleService.advance).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'observed', reasonCode: 'document_illegible' }),
    );
    expect((verificationRepository.resolveReview as jest.Mock).mock.calls[0][1]).toMatchObject({
      reviewStatus: 'rejected',
      rejectionReasonCode: 'document_illegible',
    });
    expect(result.identityVerificationResult).toBe('rejected');
  });
});

describe('CustomerComplianceScreeningService', () => {
  function build(entries: Array<Record<string, unknown>> = [], existingMatches: Array<Record<string, unknown>> = []) {
    const common = commonMocks();
    const profileDataRepository = { findCurrentProfile: jest.fn(async () => ({ id: 'p1', fullNameNormalized: 'ana paz' })) };
    const verificationRepository = {
      findActiveEntriesByHashes: jest.fn(async () => entries),
      findMatches: jest.fn(async () => existingMatches),
      createMatch: jest.fn(async () => ({ id: 'match-1' })),
      clearMatch: jest.fn(),
    };
    common.customersRepository.findById = jest.fn(async () => ({
      id: 'c1',
      lifecycleStatus: 'under_review',
      primaryPhoneHash: 'phone-hash',
      primaryEmailHash: null,
    })) as never;
    const service = new CustomerComplianceScreeningService(
      common.customersRepository as never,
      profileDataRepository as never,
      verificationRepository as never,
      common.onboardingRepository as never,
      common.lifecycleService as never,
      common.eligibilityService as never,
      common.sequelize as never,
    );
    return { service, verificationRepository, ...common };
  }

  const baseInput = { tenantId: 't1', customerId: 'c1', currentUser: analyst, ipAddress: '10.0.0.1' };

  it('sin coincidencias no registra nada ni mueve el estado del cliente', async () => {
    const { service, verificationRepository, lifecycleService } = build([]);
    const result = await service.screen(baseInput);
    expect(verificationRepository.createMatch).not.toHaveBeenCalled();
    expect(lifecycleService.advance).not.toHaveBeenCalled();
    expect(result.newMatches).toBe(0);
  });

  it('una coincidencia nueva se registra y saca al cliente del camino automático', async () => {
    const { service, verificationRepository, lifecycleService } = build([{ id: 'wl-1', entityType: 'person_name', entityHash: 'hash-1' }]);

    const result = await service.screen(baseInput);

    expect(verificationRepository.createMatch).toHaveBeenCalledTimes(1);
    expect(lifecycleService.advance).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'under_review', reasonCode: 'compliance_watchlist_match' }),
    );
    expect(result.newMatches).toBe(1);
  });

  it('es idempotente: reejecutarlo no duplica una coincidencia ya registrada', async () => {
    const { service, verificationRepository } = build(
      [{ id: 'wl-1', entityType: 'person_name', entityHash: 'hash-1' }],
      [{ id: 'match-0', watchlistEntryId: 'wl-1' }],
    );

    const result = await service.screen(baseInput);

    expect(verificationRepository.createMatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ newMatches: 0, totalMatches: 1 });
  });

  it('la auditoría registra el conteo, nunca el hash cotejado', async () => {
    const { service, onboardingRepository } = build([{ id: 'wl-1', entityType: 'person_name', entityHash: 'hash-secreto' }]);
    await service.screen(baseInput);
    const audit = JSON.stringify((onboardingRepository.createOperationalAuditLog as jest.Mock).mock.calls[0][0]);
    expect(audit).toContain('newMatches');
    expect(audit).not.toContain('hash-secreto');
  });

  it('descartar coincidencias exige pasar por el camino auditado y recalcula la elegibilidad', async () => {
    const { service, verificationRepository, eligibilityService } = build([], [{ id: 'm1' }, { id: 'm2' }]);

    const result = await service.clearMatches({ ...baseInput, reasonCode: 'false_positive', notes: 'Homónimo verificado.' });

    expect(verificationRepository.clearMatch).toHaveBeenCalledTimes(2);
    expect(eligibilityService.evaluateAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({ decisionSource: 'manual_decision', reasonCode: 'false_positive' }),
    );
    expect(result.clearedMatches).toBe(2);
  });
});
