import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock } from '../../support/jest-mocks.js';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 3): primer test real de `operations`
 * Incluye la paginación por cursor que
 * `ATLAS-P11-T10` agregó a este mismo servicio sin test dedicado — deuda que este archivo cierra.
 */
jest.mock('../../../src/modules/operations/operations.mapper.js', () => ({
  toManualReviewWorkItem: jest.fn((row: { id: string; openedAt?: string; createdAt: string }) => ({
    id: row.id,
    kind: 'manual_review',
    openedAt: row.openedAt,
    createdAt: row.createdAt,
  })),
  toFraudWorkItem: jest.fn((row: { id: string; openedAt?: string; createdAt: string }) => ({
    id: row.id,
    kind: 'fraud',
    openedAt: row.openedAt,
    createdAt: row.createdAt,
  })),
  toInvestigationSummaryResponse: jest.fn((input: unknown) => ({ mapped: true, input })),
}));

describe('OperationsService', () => {
  async function buildService() {
    const { OperationsService } = await import('../../../src/modules/operations/operations.service.js');
    const operationsRepository = {
      findManualReviewCasesForQueueWithCursor: asyncMock(),
      findFraudCasesForQueueWithCursor: asyncMock(),
      findManualReviewCasesForQueue: asyncMock(),
      findFraudCasesForQueue: asyncMock(),
      findOpenManualReviewCasesForCustomer: asyncMock(),
      findFraudCasesForCustomer: asyncMock(),
      findManualReviewCaseById: asyncMock(),
      closeManualReviewCase: asyncMock(),
      createManualReviewEvent: asyncMock(),
      createStatusEvent: asyncMock(),
      createCustomerObservation: asyncMock(),
      createOperationalAudit: asyncMock(),
      createDataChange: asyncMock(),
    };
    const customersRepository = {
      findById: asyncMock(),
      findCurrentProfile: asyncMock(),
      findContactMethods: asyncMock(),
      findCustomerConsents: asyncMock(),
    };
    const riskRepository = {
      findLatestCustomerRiskResult: asyncMock(),
      findRiskResultByRun: asyncMock(),
      applyManualReviewOutcome: asyncMock(),
    };
    const lifecycleService = { transition: asyncMock() };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };

    const contactsSnapshotService = {
      featuresFor: jest.fn(async (..._args: unknown[]) => ({
        available: false,
        totalContacts: 0,
        uniqueRatio: 0,
        bolivianRatio: 0,
        referencesFoundInAddressBook: 0,
        riskMatches: 0,
      })),
    };
    const service = new OperationsService(
      operationsRepository as never,
      customersRepository as never,
      // Los contactos del cliente viven en `CustomerContactsRepository`; el doble ya los expone.
      customersRepository as never,
      riskRepository as never,
      lifecycleService as never,
      // La agenda del cliente la calcula y la guarda el módulo de alta; aquí sólo se lee. El doble
      // devuelve «no disponible», que es el mismo camino que toma un cliente sin captura.
      contactsSnapshotService as never,
      sequelize as never,
    );
    return { service, operationsRepository, customersRepository, riskRepository, lifecycleService };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: null } as never;

  describe('getInvestigationSummary', () => {
    it('throws NotFoundException when the customer does not exist', async () => {
      const { service, customersRepository } = await buildService();
      (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.getInvestigationSummary('t1', { customerId: 'c1' } as never)).rejects.toThrow(NotFoundException);
    });
  });

  describe('decideManualReviewCase', () => {
    function baseInput(overrides: Record<string, unknown> = {}) {
      return {
        tenantId: 't1',
        params: { caseId: 'case-1' } as never,
        body: { decision: 'approved', reasonCode: 'r1' } as never,
        currentUser: internalUser,
        idempotencyKey: 'idem-1',
        ...overrides,
      };
    }

    it('throws BadRequestException without an idempotency key', async () => {
      const { service } = await buildService();
      await expect(service.decideManualReviewCase(baseInput({ idempotencyKey: '' }))).rejects.toThrow(BadRequestException);
    });

    it.each(['rejected', 'request_more_information'])(
      'throws DECISION_REASON_REQUIRED for decision "%s" without notes',
      async (decision) => {
        const { service } = await buildService();
        await expect(service.decideManualReviewCase(baseInput({ body: { decision, reasonCode: 'r1' } }))).rejects.toThrow(
          /DECISION_REASON_REQUIRED/,
        );
      },
    );

    it('does not require notes for "approved" or "no_action"', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
      } as never);

      const result = await service.decideManualReviewCase(baseInput({ body: { decision: 'approved', reasonCode: 'r1' } }));

      expect(result.decision).toBe('approved');
    });

    it('throws CASE_NOT_FOUND when the case does not exist', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce(null as never);
      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(/CASE_NOT_FOUND/);
    });

    /**
     * Dos bandejas para el mismo cliente es peor que una bandeja incómoda.
     *
     * Cuando el Motor resolvió la evaluación, él abrió su propio caso con su expediente y su
     * auditoría; esta fila es sólo el ancla del flujo de alta. Si además se pudiera cerrar desde
     * aquí habría dos decisiones para la misma persona, tomadas por gente que no se ve, y ninguna
     * respuesta a «quién aprobó». Se corta en el servicio y no en la pantalla porque una pantalla
     * se salta con curl.
     */
    it('rechaza decidir un caso DELEGADO al Motor, aunque esté abierto', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
        decisionExecutionId: 'exec-9182',
      } as never);

      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(/MANUAL_REVIEW_DELEGADA_AL_MOTOR/);
    });

    /**
     * C-1: el caso PROPIO que abre el crédito cuando el Motor manda una solicitud a revisión sin abrir
     * el suyo aparece en esta misma cola. Cerrarlo aquí, con el formulario de riesgo, dejaría la
     * solicitud `under_review` con su caso ya cerrado y sin nadie que la resuelva: se decide sobre la
     * SOLICITUD, que además cierra el caso.
     */
    it('rechaza decidir aquí el caso de una solicitud de crédito: se decide sobre la solicitud', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: '10',
        decisionExecutionId: null,
        caseType: 'credit_application_review',
      } as never);

      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(/MANUAL_REVIEW_ES_DE_CREDITO/);
      expect(operationsRepository.closeManualReviewCase).not.toHaveBeenCalled();
    });

    it('rechaza decidir aquí el caso de identidad: se decide en el panel de identidad, que lo cierra', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: '10',
        decisionExecutionId: null,
        caseType: 'identity_review',
      } as never);

      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(/MANUAL_REVIEW_ES_DE_IDENTIDAD/);
      expect(operationsRepository.closeManualReviewCase).not.toHaveBeenCalled();
    });

    it('sí deja decidir cuando la decisión salió de la política local (sin ejecución del Motor)', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
        decisionExecutionId: null,
      } as never);

      const result = await service.decideManualReviewCase(baseInput({ body: { decision: 'approved', reasonCode: 'r1' } }));

      expect(result.decision).toBe('approved');
    });

    it('throws CASE_ALREADY_CLOSED when closedAt is set', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({ closedAt: new Date(), status: 'open' } as never);
      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(ConflictException);
    });

    it('throws CASE_ALREADY_CLOSED when status is "closed" even if closedAt is somehow still null', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({ closedAt: null, status: 'closed' } as never);
      await expect(service.decideManualReviewCase(baseInput())).rejects.toThrow(ConflictException);
    });

    /**
     * Regresión de H1. Antes, esta rama insertaba el evento de historial con `previousStatus: null`
     * y NUNCA actualizaba `customers.lifecycle_status`: el historial decía "aprobado" y el cliente
     * seguía en su estado anterior. La transición ahora la aplica `CustomerLifecycleService`, que
     * valida contra la máquina de estados y escribe estado + evento en la misma transacción.
     */
    it('aplica la transición REAL de estado vía CustomerLifecycleService, no solo un evento de historial', async () => {
      const { service, operationsRepository, lifecycleService } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: 'c1',
      } as never);
      (lifecycleService.transition as jest.Mock).mockResolvedValueOnce({
        previousStatus: 'under_review',
        newStatus: 'active',
        changed: true,
      } as never);

      const result = await service.decideManualReviewCase(
        baseInput({ body: { decision: 'approved', reasonCode: 'r1', nextCustomerStatus: 'active' } }),
      );

      expect(lifecycleService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'c1', toStatus: 'active', reasonCode: 'r1', changedByInternalUserId: 'iu1' }),
      );
      // El evento de historial ya no se escribe aquí a mano: lo emite el servicio de ciclo de vida
      // junto con el UPDATE del estado, para que no puedan divergir.
      expect(operationsRepository.createStatusEvent).not.toHaveBeenCalled();
      expect(operationsRepository.createCustomerObservation).toHaveBeenCalledTimes(1);
      expect(result.nextCustomerStatus).toBe('active');
    });

    it('«approved» corrige el resultado de riesgo del que nació el caso (si no, RISK_NOT_APPROVED se queda para siempre)', async () => {
      const { service, operationsRepository, riskRepository } = await buildService();
      operationsRepository.findManualReviewCaseById.mockResolvedValue({
        id: '3',
        customerId: '26',
        riskAssessmentRunId: '8',
        status: 'open',
        closedAt: null,
        decisionExecutionId: null,
      } as never);
      const resultado = { id: '8', recommendedAction: 'manual_review_required' };
      riskRepository.findRiskResultByRun.mockResolvedValue(resultado as never);

      await service.decideManualReviewCase(baseInput({ body: { decision: 'approved', reasonCode: 'manual_review_ok' } }));

      expect(riskRepository.findRiskResultByRun).toHaveBeenCalledWith('t1', '8');
      expect(riskRepository.applyManualReviewOutcome).toHaveBeenCalledWith(
        resultado,
        expect.objectContaining({ recommendedAction: 'approved_for_next_step', reason: 'manual_review_ok' }),
        expect.anything(),
      );
    });

    it('«request_more_information» NO toca la recomendación de riesgo', async () => {
      const { service, operationsRepository, riskRepository } = await buildService();
      operationsRepository.findManualReviewCaseById.mockResolvedValue({
        id: '3',
        customerId: '26',
        riskAssessmentRunId: '8',
        status: 'open',
        closedAt: null,
        decisionExecutionId: null,
      } as never);

      await service.decideManualReviewCase(
        baseInput({ body: { decision: 'request_more_information', reasonCode: 'r1', notes: 'falta el domicilio' } }),
      );

      expect(riskRepository.applyManualReviewOutcome).not.toHaveBeenCalled();
    });

    it('does NOT create a status event when nextCustomerStatus is missing, even if the case has a customerId', async () => {
      const { service, operationsRepository, lifecycleService } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: 'c1',
      } as never);

      await service.decideManualReviewCase(baseInput({ body: { decision: 'approved', reasonCode: 'r1' } }));

      expect(lifecycleService.transition).not.toHaveBeenCalled();
      expect(operationsRepository.createStatusEvent).not.toHaveBeenCalled();
    });

    it('does NOT create a status event when the case has no customerId, even if nextCustomerStatus is given', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
      } as never);

      await service.decideManualReviewCase(
        baseInput({ body: { decision: 'approved', reasonCode: 'r1', nextCustomerStatus: 'approved_for_next_step' } }),
      );

      expect(operationsRepository.createStatusEvent).not.toHaveBeenCalled();
    });

    it('always writes an operational audit entry and a data-change log entry, regardless of customerId', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
      } as never);

      await service.decideManualReviewCase(baseInput());

      expect(operationsRepository.createOperationalAudit).toHaveBeenCalledTimes(1);
      expect(operationsRepository.createDataChange).toHaveBeenCalledTimes(1);
    });

    it('the response always reports caseStatus "closed"', async () => {
      const { service, operationsRepository } = await buildService();
      (operationsRepository.findManualReviewCaseById as jest.Mock).mockResolvedValueOnce({
        closedAt: null,
        status: 'open',
        customerId: null,
      } as never);

      const result = await service.decideManualReviewCase(baseInput());

      expect(result.caseStatus).toBe('closed');
    });
  });
});
