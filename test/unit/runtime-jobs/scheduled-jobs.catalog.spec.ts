import { describe, expect, it, jest } from '@jest/globals';
import { buildScheduledJobs } from '../../../src/modules/runtime-jobs/scheduled-jobs.catalog.js';

/**
 * Los dos jobs que cierran el bucle de la cartera sin que nadie pulse nada. Antes la entrega de
 * desenlaces y la calificación sólo existían como botones del portal, y `loan_outcome_reports` se
 * llenaba sin vaciarse nunca.
 */
describe('buildScheduledJobs · cartera y desenlaces', () => {
  function build() {
    const debtRating = { sweep: jest.fn(async (..._args: unknown[]) => ({ customers: 2, rated: 2, failed: 0, failedCustomerIds: [] })) };
    const outcomeDispatch = { dispatchPending: jest.fn(async (..._args: unknown[]) => ({ sent: 3, failed: 0, skipped: 0 })) };
    const jobs = buildScheduledJobs({
      runtimeJobs: {} as never,
      maintenance: {} as never,
      onboardingAbandonment: {} as never,
      delinquency: { sweep: jest.fn() } as never,
      creditLineRefresh: {} as never,
      bankStatements: {} as never,
      supportSla: {} as never,
      debtRating: debtRating as never,
      outcomeDispatch: outcomeDispatch as never,
    });
    return { jobs, debtRating, outcomeDispatch };
  }

  it('dispatch_loan_outcomes entrega los desenlaces del tenant que le toca', async () => {
    const { jobs, outcomeDispatch } = build();
    const job = jobs.find((entry) => entry.jobCode === 'dispatch_loan_outcomes');
    expect(job).toBeDefined();
    expect(job!.intervalMs).toBeGreaterThan(0);
    await job!.run('7');
    expect(outcomeDispatch.dispatchPending).toHaveBeenCalledWith({ tenantId: '7', limit: expect.any(Number) });
  });

  it('sweep_debt_ratings recalifica la cartera del tenant que le toca', async () => {
    const { jobs, debtRating } = build();
    const job = jobs.find((entry) => entry.jobCode === 'sweep_debt_ratings');
    expect(job).toBeDefined();
    await job!.run('7');
    expect(debtRating.sweep).toHaveBeenCalledWith({ tenantId: '7', limit: expect.any(Number) });
  });

  it('el barrido de mora sigue yendo ANTES que la entrega: primero se observa, luego se manda', () => {
    const { jobs } = build();
    const codes = jobs.map((job) => job.jobCode);
    expect(codes.indexOf('sweep_loan_delinquency')).toBeLessThan(codes.indexOf('dispatch_loan_outcomes'));
  });
});
