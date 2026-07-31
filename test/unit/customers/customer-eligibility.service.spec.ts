import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerEligibilityService } from '../../../src/modules/customers/application/customer-eligibility.service.js';

/**
 * Motor de habilitación: orquestación y evidencia.
 *
 * La habilitación NO es una bandera que alguien pueda escribir. Estos tests fijan las dos
 * propiedades que la hacen defendible: (a) toda evaluación —favorable o no— deja una fila de
 * evidencia con la versión de la regla, y (b) la promoción automática a `active` solo ocurre desde
 * `under_review`, nunca desde un estado en el que el cliente todavía está cargando datos ni desde
 * uno bloqueado.
 */
describe('CustomerEligibilityService', () => {
  const ALL_GOOD_FACTS = {
    hasCredentials: true,
    verifiedContactCount: 1,
    profile: { id: 1, firstName: 'Ana', lastName: 'Paz', birthDate: '1990-01-01' },
    presentFinancialAttributeCodes: [
      'employment_status',
      'employment_seniority_months',
      'monthly_income_declared',
      'monthly_expenses_declared',
      'economic_activity_code',
      'source_of_funds',
    ],
    hasCurrentAddress: true,
    referenceContactCount: 2,
    identityDocument: { id: 9, expiresAt: '2030-01-01' },
    identityVerificationResult: 'verified',
    pendingEvidenceReviewCount: 0,
    grantedConsentDocumentIds: ['1'],
    requiredConsentDocumentIds: ['1'],
    openObservationCount: 0,
    unclearedWatchlistMatchCount: 0,
    latestRisk: { id: 4, recommendedAction: 'approved_for_next_step', decidedAt: new Date() },
    openFraudCaseCount: 0,
  };

  function build(lifecycleStatus = 'under_review', facts: Record<string, unknown> = ALL_GOOD_FACTS) {
    const customer = { id: 'c1', lifecycleStatus, creditEligibilityStatus: null, eligibilityEvaluatedAt: null, updatedAtValue: null };
    const customersRepository = { findById: jest.fn(async () => customer) };
    const eligibilityRepository = { loadFacts: jest.fn(async () => facts) };
    const lifecycleRepository = {
      createEvaluation: jest.fn(async () => ({ id: 'ev1' })),
      applyEligibilityCache: jest.fn(),
      findLatestEvaluation: jest.fn(async () => null),
    };
    const lifecycleService = {
      advance: jest.fn(async () => ({ previousStatus: lifecycleStatus, newStatus: 'active', changed: true })),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new CustomerEligibilityService(
      customersRepository as never,
      eligibilityRepository as never,
      lifecycleRepository as never,
      lifecycleService as never,
      sequelize as never,
    );
    return { service, customersRepository, eligibilityRepository, lifecycleRepository, lifecycleService, customer };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null } as never;

  it('un cliente no puede consultar la habilitación de otro', async () => {
    const { service } = build();
    await expect(service.getEligibility({ tenantId: 't1', customerId: 'otro', currentUser: customerUser })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lanza NotFoundException cuando el cliente no existe', async () => {
    const { service, customersRepository } = build();
    (customersRepository.findById as jest.Mock).mockResolvedValue(null as never);
    await expect(service.evaluate('t1', 'c1')).rejects.toThrow(NotFoundException);
  });

  it('promueve a active desde under_review cuando lo único que faltaba era el estado', async () => {
    const { service, lifecycleService } = build('under_review');

    const result = await service.getEligibility({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

    expect(lifecycleService.advance).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'active', reasonCode: 'eligibility_conditions_met' }),
    );
    expect(result.eligible).toBe(true);
  });

  it('NO promueve desde onboarding_in_progress: el cliente todavía no envió su paquete', async () => {
    const { service, lifecycleService } = build('onboarding_in_progress');
    const result = await service.getEligibility({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });
    expect(lifecycleService.advance).not.toHaveBeenCalled();
    expect(result.eligible).toBe(false);
    expect(result.blockers.map((b) => b.code)).toEqual(['ACCOUNT_NOT_ACTIVE']);
  });

  it('NO promueve a un cliente bloqueado, aunque el resto de condiciones se cumpla', async () => {
    const { service, lifecycleService } = build('blocked');
    const result = await service.getEligibility({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });
    expect(lifecycleService.advance).not.toHaveBeenCalled();
    expect(result.eligible).toBe(false);
  });

  it('NO promueve cuando además del estado falta cualquier otra condición', async () => {
    const { service, lifecycleService } = build('under_review', { ...ALL_GOOD_FACTS, verifiedContactCount: 0 });
    await service.getEligibility({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });
    expect(lifecycleService.advance).not.toHaveBeenCalled();
  });

  it('toda evaluación deja evidencia persistida con la versión de la regla y un hash de los insumos', async () => {
    const { service, lifecycleRepository } = build('onboarding_in_progress');

    await service.getEligibility({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });

    const evaluation = (lifecycleRepository.createEvaluation as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(evaluation).toMatchObject({
      customerId: 'c1',
      eligible: false,
      lifecycleStatus: 'onboarding_in_progress',
      ruleVersion: 'eligibility-v1',
      decisionSource: 'automatic',
    });
    expect(String(evaluation.factsHash)).toHaveLength(64); // sha256 hex
  });

  it('el hash de insumos NO contiene PII: solo identificadores y contadores derivados', async () => {
    const { service, lifecycleRepository } = build('active');
    await service.getEligibility({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });
    const evaluation = (lifecycleRepository.createEvaluation as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(evaluation);
    expect(serialized).not.toContain('Ana');
    expect(serialized).not.toContain('1990-01-01');
  });

  it('actualiza la caché de elegibilidad del cliente junto con la evidencia', async () => {
    const { service, lifecycleRepository, customer } = build('active');
    await service.getEligibility({ tenantId: 't1', customerId: 'c1', currentUser: customerUser });
    expect(lifecycleRepository.applyEligibilityCache).toHaveBeenCalledWith(
      customer,
      { eligible: true, now: expect.any(Date) },
      { transaction: {} },
    );
  });

  it('evaluate() no persiste nada: es la variante de solo lectura para composiciones', async () => {
    const { service, lifecycleRepository } = build('active');
    const result = await service.evaluate('t1', 'c1');
    expect(result.eligible).toBe(true);
    expect(lifecycleRepository.createEvaluation).not.toHaveBeenCalled();
  });
});
