/**
 * @file Verifica el barrido que recoge las solicitudes de crédito atascadas en `submitted`.
 * @business Una fila que se queda `submitted` bloquea al cliente para siempre por el índice único de solicitud abierta.
 * @system Ejercita `CreditSubmittedReconciliationService` y su declaración como trabajo programado (C-2).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { CreditSubmittedReconciliationService } from '../../../src/modules/credit/application/credit-submitted-reconciliation.service.js';
import { buildCreditScheduledJobs } from '../../../src/modules/runtime-jobs/scheduled-jobs.credit.js';

const now = new Date('2026-09-25T12:00:00.000Z');

const stale = (id: string) => ({
  id,
  customerId: `c${id}`,
  creditProductId: '21',
  applicationCode: `CRA-${id}`,
  requestedAmount: '5000.00',
  requestedTermMonths: 12,
  currencyCode: 'BOB',
  purposeCode: null,
});

function build(applications: Array<ReturnType<typeof stale>> = [], underwriteResult: Record<string, unknown> = { status: 'under_review' }) {
  const credit = {
    findStaleSubmittedApplications: jest.fn(async (..._args: unknown[]) => applications),
    findProductById: jest.fn(async (..._args: unknown[]) => ({ productCode: 'consumo_30' })),
  };
  const underwriting = { underwrite: jest.fn(async (..._args: unknown[]) => underwriteResult) };
  const service = new CreditSubmittedReconciliationService(credit as never, underwriting as never);
  return { service, credit, underwriting };
}

describe('CreditSubmittedReconciliationService', () => {
  it('busca las submitted más viejas que la gracia: una recién creada está submitted legítimamente', async () => {
    const { service, credit } = build();

    await service.reconcile({ tenantId: '7', graceMinutes: 15, limit: 20, now });

    // 12:00 - 15 min: el submit que todavía espera al motor no se pisa.
    expect(credit.findStaleSubmittedApplications).toHaveBeenCalledWith('7', new Date('2026-09-25T11:45:00.000Z'), 20);
  });

  it('vuelve a decidir cada solicitud atascada por el MISMO camino que el submit', async () => {
    const { service, underwriting } = build([stale('31'), stale('32')]);

    const result = await service.reconcile({ tenantId: '7', graceMinutes: 15, limit: 20, now });

    expect(underwriting.underwrite).toHaveBeenCalledTimes(2);
    expect(underwriting.underwrite).toHaveBeenCalledWith({
      tenantId: '7',
      applicationId: '31',
      customerId: 'c31',
      applicationCode: 'CRA-31',
      requestedAmount: '5000.00',
      requestedTermMonths: 12,
      currencyCode: 'BOB',
      productCode: 'consumo_30',
      purposeCode: null,
    });
    expect(result).toEqual({ scanned: 2, resolved: 2, failed: 0 });
  });

  it('una que falla no impide recoger las demás, y se cuenta para la próxima pasada', async () => {
    const { service, underwriting } = build([stale('31'), stale('32'), stale('33')]);
    underwriting.underwrite.mockRejectedValueOnce(new Error('sin conexión') as never);

    const result = await service.reconcile({ tenantId: '7', graceMinutes: 15, limit: 20, now });

    expect(underwriting.underwrite).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ scanned: 3, resolved: 2, failed: 1 });
  });

  it('una solicitud que sigue submitted tras volver a decidirla cuenta como sin resolver, no como recogida', async () => {
    const { service } = build([stale('31')], { status: 'submitted' });

    await expect(service.reconcile({ tenantId: '7', graceMinutes: 15, limit: 20, now })).resolves.toEqual({
      scanned: 1,
      resolved: 0,
      failed: 1,
    });
  });

  it('sin solicitudes atascadas no llama al motor', async () => {
    const { service, underwriting } = build([]);

    await expect(service.reconcile({ tenantId: '7', graceMinutes: 15, limit: 20, now })).resolves.toEqual({
      scanned: 0,
      resolved: 0,
      failed: 0,
    });
    expect(underwriting.underwrite).not.toHaveBeenCalled();
  });
});

describe('buildCreditScheduledJobs', () => {
  it('reconcile_submitted_credit_applications recoge las atascadas del tenant que le toca, con gracia y tope de la configuración', async () => {
    const creditReconciliation = { reconcile: jest.fn(async (..._args: unknown[]) => ({ scanned: 0, resolved: 0, failed: 0 })) };
    const jobs = buildCreditScheduledJobs({ creditReconciliation: creditReconciliation as never });

    const job = jobs.find((entry) => entry.jobCode === 'reconcile_submitted_credit_applications');
    expect(job).toBeDefined();
    expect(job!.intervalMs).toBe(env.RUNTIME_JOBS_CREDIT_RECONCILE_INTERVAL_MS);
    await job!.run('7');

    expect(creditReconciliation.reconcile).toHaveBeenCalledWith({
      tenantId: '7',
      graceMinutes: env.RUNTIME_JOBS_CREDIT_SUBMITTED_GRACE_MINUTES,
      limit: env.RUNTIME_JOBS_CREDIT_RECONCILE_LIMIT,
    });
  });

  it('por defecto la gracia es de 15 minutos', () => {
    expect(env.RUNTIME_JOBS_CREDIT_SUBMITTED_GRACE_MINUTES).toBe(15);
  });
});
