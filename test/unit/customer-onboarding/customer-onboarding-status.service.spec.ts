import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { CustomerOnboardingStatusService } from '../../../src/modules/customer-onboarding/application/customer-onboarding-status.service.js';

/**
 * Estado, envío y observaciones del onboarding.
 *
 * Estos tres endpoints no existían, y sin ellos el proceso no se podía reanudar: un cliente que
 * cerraba la app no tenía a dónde volver (`GET /customers/:id/me` devolvía `onboarding: null` fijo)
 * y uno observado por un analista no tenía forma de enterarse de qué le pedían.
 */
describe('CustomerOnboardingStatusService', () => {
  const completeAssessment = {
    eligible: false,
    lifecycleStatus: 'onboarding_in_progress',
    ruleVersion: 'eligibility-v1',
    sections: [
      { code: 'contact_verification', status: 'completed', missingFields: [] },
      { code: 'personal_data', status: 'completed', missingFields: [] },
    ],
    completionPercentage: 100,
    canSubmit: true,
    nextStep: 'complete',
    blockers: [],
  };

  function build(assessment: Record<string, unknown> = completeAssessment) {
    const customersRepository = {
      findById: jest.fn(async (..._args: unknown[]) => ({
        id: 'c1',
        lifecycleStatus: 'onboarding_in_progress',
        creditEligibilityStatus: null,
      })),
    };
    const onboardingRepository = {
      findLatestOnboardingFlow: jest.fn(async (..._args: unknown[]) => ({
        id: 'flow-1',
        flowVersion: 'v1',
        completionStatus: 'in_progress',
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
        completedAt: null,
        abandonedAt: null,
      })),
      createOnboardingStepEvent: jest.fn(),
      createOperationalAuditLog: jest.fn(),
    };
    const flowRepository = { closeOnboardingFlow: jest.fn() };
    const eligibilityService = {
      evaluate: jest.fn(async (..._args: unknown[]) => assessment),
      evaluateAndRecord: jest.fn(async (..._args: unknown[]) => ({
        ...assessment,
        eligible: true,
        lifecycleStatus: 'active',
        evaluatedAt: 'now',
      })),
    };
    const eligibilityRepository = {};
    // Las observaciones y los casos abiertos viven en el repositorio de cumplimiento y riesgo.
    const eligibilityRiskRepository = {
      findOpenIssues: jest.fn(async (..._args: unknown[]) => []),
      findOpenReviewCases: jest.fn(async (..._args: unknown[]) => []),
    };
    const lifecycleService = { transition: jest.fn(), advance: jest.fn() };
    // El envío a revisión dispara la evaluación de riesgo: sin ella la habilitación automática no
    // podía ocurrir nunca, porque la regla exige `RISK_NOT_APPROVED` resuelto y nada en el
    // onboarding la pedía.
    const riskService = { createRiskAssessment: jest.fn(async (..._args: unknown[]) => ({ id: 'risk-1' })) };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const service = new CustomerOnboardingStatusService(
      customersRepository as never,
      onboardingRepository as never,
      flowRepository as never,
      eligibilityService as never,
      eligibilityRepository as never,
      eligibilityRiskRepository as never,
      lifecycleService as never,
      riskService as never,
      sequelize as never,
    );
    return {
      service,
      customersRepository,
      onboardingRepository,
      flowRepository,
      eligibilityService,
      eligibilityRepository,
      eligibilityRiskRepository,
      lifecycleService,
      riskService,
    };
  }

  const customerUser = { role: 'customer', customerId: 'c1', internalUserId: null } as never;
  const baseInput = { tenantId: 't1', customerId: 'c1', currentUser: customerUser };

  describe('getStatus', () => {
    it('lanza NotFoundException cuando el cliente no existe', async () => {
      const { service, customersRepository } = build();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.getStatus(baseInput)).rejects.toThrow(NotFoundException);
    });

    it('devuelve el flujo real, el avance calculado en el servidor y el próximo paso', async () => {
      const { service } = build();
      const result = await service.getStatus(baseInput);
      expect(result.onboarding).toMatchObject({ onboardingFlowId: 'flow-1', completionStatus: 'in_progress' });
      expect(result.completionPercentage).toBe(100);
      expect(result.sections).toHaveLength(2);
      expect(result.nextStep).toBe('complete');
    });

    it('no ofrece enviar cuando el cliente ya está en revisión', async () => {
      const { service } = build({ ...completeAssessment, lifecycleStatus: 'under_review' });
      const result = await service.getStatus(baseInput);
      expect(result.canSubmit).toBe(false);
    });
  });

  describe('submitForReview', () => {
    const submitInput = { ...baseInput, ipAddress: '10.0.0.1', idempotencyKey: 'idem-1' };

    it('rechaza el envío cuando quedan secciones incompletas, listando cuáles', async () => {
      const { service, lifecycleService } = build({
        ...completeAssessment,
        canSubmit: false,
        sections: [
          { code: 'personal_data', status: 'completed', missingFields: [] },
          { code: 'financial_profile', status: 'pending', missingFields: ['monthly_income_declared'] },
        ],
      });
      await expect(service.submitForReview(submitInput)).rejects.toThrow(/ONBOARDING_INCOMPLETE: financial_profile/);
      expect(lifecycleService.transition).not.toHaveBeenCalled();
    });

    it('rechaza reenviar un paquete que ya está en revisión', async () => {
      const { service, customersRepository } = build();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'under_review' } as never);
      await expect(service.submitForReview(submitInput)).rejects.toThrow(/ONBOARDING_ALREADY_SUBMITTED/);
    });

    it('mueve a under_review, CIERRA el flujo de onboarding y reevalúa la habilitación', async () => {
      const { service, lifecycleService, flowRepository, eligibilityService } = build();

      const result = await service.submitForReview(submitInput);

      expect(lifecycleService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'under_review', reasonCode: 'onboarding_submitted' }),
      );
      // Regresión H4: `completion_status` se escribía una sola vez como `in_progress` y nunca se
      // actualizaba; sin este cierre no existen tasa de conversión ni tiempo por etapa.
      expect(flowRepository.closeOnboardingFlow).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'flow-1' }),
        { completionStatus: 'completed', closedAt: expect.any(Date) },
        { transaction: {} },
      );
      expect(eligibilityService.evaluateAndRecord).toHaveBeenCalledWith(
        expect.objectContaining({ decisionSource: 'automatic', reasonCode: 'onboarding_submitted' }),
      );
      expect(result).toMatchObject({ lifecycleStatus: 'active', eligible: true });
    });

    /**
     * Lo que faltaba para que la habilitación automática pudiera ocurrir alguna vez: la regla exige
     * `RISK_NOT_APPROVED` resuelto y `createRiskAssessment` solo existía como endpoint HTTP, así que
     * el cliente quedaba en `under_review` esperando un paso a mano que el flujo nunca pedía.
     */
    it('dispara la evaluación de riesgo del onboarding, con clave de idempotencia propia', async () => {
      const { service, riskService } = build();

      await service.submitForReview(submitInput);

      expect(riskService.createRiskAssessment).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          customerId: 'c1',
          body: { assessmentType: 'onboarding_initial', channel: 'system' },
          idempotencyKey: expect.stringContaining(':onboarding-risk'),
        }),
      );
    });

    /** Perder el envío por una caída del motor obligaría al cliente a repetir todo el recorrido. */
    it('si la evaluación de riesgo falla, el envío igual procede', async () => {
      const { service, riskService, lifecycleService } = build();
      (riskService.createRiskAssessment as jest.Mock).mockRejectedValueOnce(new Error('motor caído') as never);

      await expect(service.submitForReview(submitInput)).resolves.toMatchObject({ lifecycleStatus: 'active' });
      expect(lifecycleService.transition).toHaveBeenCalledWith(expect.objectContaining({ toStatus: 'under_review' }));
    });

    /**
     * El perdedor de una carrera entre dos envíos recibe el mismo error de negocio que quien
     * reintenta, no un `INVALID_STATUS_TRANSITION` de la máquina de estados.
     */
    it('rechaza el segundo envío cuando el estado ya cambió dentro de la transacción', async () => {
      const { service, customersRepository, lifecycleService } = build();
      (customersRepository.findById as jest.Mock)
        .mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'onboarding_in_progress', creditEligibilityStatus: null } as never)
        .mockResolvedValueOnce({ id: 'c1', lifecycleStatus: 'under_review', creditEligibilityStatus: null } as never);

      await expect(service.submitForReview(submitInput)).rejects.toThrow(/ONBOARDING_ALREADY_SUBMITTED/);
      expect(lifecycleService.transition).not.toHaveBeenCalled();
    });

    /** Desde `active`, `rejected` o `closed` el paquete ya no está en juego. */
    it('rechaza el envío desde un estado que ya no admite revisión', async () => {
      const { service, customersRepository } = build();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce({
        id: 'c1',
        lifecycleStatus: 'active',
        creditEligibilityStatus: null,
      } as never);

      await expect(service.submitForReview(submitInput)).rejects.toThrow(/ONBOARDING_NOT_SUBMITTABLE_IN_STATUS/);
    });
  });

  describe('listObservations', () => {
    it('devuelve observaciones y casos abiertos SIN exponer las notas internas del analista', async () => {
      const { service, eligibilityRiskRepository } = build();
      (eligibilityRiskRepository.findOpenIssues as jest.Mock).mockResolvedValueOnce([
        { id: 'i1', issueStatus: 'open', detectedAt: new Date('2026-07-10T00:00:00.000Z') },
      ] as never);
      (eligibilityRiskRepository.findOpenReviewCases as jest.Mock).mockResolvedValueOnce([
        { id: 'case-1', caseType: 'risk_assessment_review', priority: 'high', status: 'open', openedAt: null, notes: 'criterio interno' },
      ] as never);

      const result = await service.listObservations(baseInput);

      expect(result.observations).toEqual([
        { observationId: 'i1', source: 'data_quality', status: 'open', detectedAt: '2026-07-10T00:00:00.000Z' },
      ]);
      expect(result.reviewCases[0]).not.toHaveProperty('notes');
      expect(JSON.stringify(result)).not.toContain('criterio interno');
    });
  });
});
