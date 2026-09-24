import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { FacilityRegistrationService, GRANTED_LOAN_STATUSES } from '../../../src/modules/decision-engine/facility-registration.service.js';
import { assessPortfolioReconciliation, type PortfolioSnapshot } from '../../../src/modules/decision-engine/portfolio-reconciliation.js';
import { PortfolioReconciliationService } from '../../../src/modules/decision-engine/portfolio-reconciliation.service.js';

/**
 * P-11 · cierre del circuito de desenlaces: sólo se dan de alta créditos concedidos de verdad, y la
 * conciliación con el motor alerta la ausencia de datos en vez de declarar la cartera sana.
 */
const healthy: PortfolioSnapshot = {
  engineReportingConfigured: true,
  grantedWithExecution: 10,
  grantedWithoutExecution: 0,
  registeredFacilities: 10,
  unregisteredStale: 0,
  outcomesPending: 3,
  outcomesExhausted: 0,
  outcomesSent: 20,
};

describe('P-11 · conciliación de cartera Core ↔ Motor', () => {
  it('cartera vacía NO es cartera sana: NO_DATA', () => {
    const result = assessPortfolioReconciliation({ ...healthy, grantedWithExecution: 0, registeredFacilities: 0, outcomesSent: 0 });
    expect(result.status).toBe('NO_DATA');
    expect(result.alerts).toEqual(['NO_ATTRIBUTABLE_PORTFOLIO']);
  });

  it.each([
    ['motor sin credencial de reporte', { engineReportingConfigured: false }, 'ENGINE_REPORTING_NOT_CONFIGURED'],
    ['créditos concedidos sin alta', { unregisteredStale: 2 }, 'FACILITIES_NOT_REGISTERED:2'],
    ['créditos sin ejecución', { grantedWithoutExecution: 1 }, 'GRANTED_WITHOUT_EXECUTION:1'],
    ['desenlaces agotados', { outcomesExhausted: 4 }, 'OUTCOMES_EXHAUSTED:4'],
    ['ningún alta jamás', { registeredFacilities: 0 }, 'NO_FACILITY_EVER_REGISTERED'],
  ])('%s → ALERT (%s)', (_name, overrides, alert) => {
    const result = assessPortfolioReconciliation({ ...healthy, ...overrides });
    expect(result.status).toBe('ALERT');
    expect(result.alerts).toContain(alert);
  });

  it('sólo con cartera, todo registrado y nada agotado: RECONCILED', () => {
    expect(assessPortfolioReconciliation(healthy)).toEqual({ status: 'RECONCILED', alerts: [], snapshot: healthy });
  });

  it('el servicio cuenta en el libro y en la cola y delega el veredicto', async () => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const loans = { count: jest.fn(async () => counts.shift() ?? 0) };
    const outcomes = { count: jest.fn(async () => counts.shift() ?? 0) };
    const service = new PortfolioReconciliationService({ canReportOutcomes: true } as never, loans as never, outcomes as never);
    const result = await service.reconcile({ tenantId: '1', now: new Date('2026-09-24T00:00:00Z') });
    expect(result.status).toBe('NO_DATA');
    expect(loans.count).toHaveBeenCalledTimes(4);
    expect(outcomes.count).toHaveBeenCalledTimes(3);
  });

  it('el alta sólo recorre préstamos realmente concedidos, no cancelados ni pendientes de desembolso', async () => {
    const loanModel = { findAll: jest.fn(async (..._args: unknown[]) => []) };
    const service = new FacilityRegistrationService({ canReportOutcomes: true } as never, loanModel as never);
    await service.registrarCreditosNuevos({ tenantId: '1', limit: 10 });
    const where = (loanModel.findAll.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ deleted: false });
    expect((where.status as Record<symbol, unknown>)[Op.in]).toEqual([...GRANTED_LOAN_STATUSES]);
    expect(GRANTED_LOAN_STATUSES).not.toContain('cancelled');
    expect(GRANTED_LOAN_STATUSES).not.toContain('pending_disbursement');
  });
});
