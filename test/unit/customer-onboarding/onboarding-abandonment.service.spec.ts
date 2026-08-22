import { describe, expect, it, jest } from '@jest/globals';
import { OnboardingAbandonmentService } from '../../../src/modules/customer-onboarding/application/onboarding-abandonment.service.js';

/**
 * Cierre del otro extremo del embudo.
 *
 * `completion_status` se escribía una sola vez como `in_progress` y no volvía a tocarse: `abandoned_at`
 * quedaba en `null` para siempre y la tasa de abandono —la métrica que dice si el registro funciona—
 * no existía. Lo importante aquí es el CRITERIO: el corte es por última actividad, no por fecha de
 * inicio, porque quien seguía cargando datos al día 31 quedaba marcado como abandonado en plena sesión.
 */
describe('OnboardingAbandonmentService.markAbandonedFlows', () => {
  function build(candidates: { id: string }[], recentEvents: { onboardingFlowId: string }[] = []) {
    const flowModel = { findAll: jest.fn(async (..._args: unknown[]) => candidates) };
    const stepEventModel = { findAll: jest.fn(async (..._args: unknown[]) => recentEvents) };
    const flowRepository = { closeOnboardingFlow: jest.fn() };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new OnboardingAbandonmentService(
      flowModel as never,
      stepEventModel as never,
      flowRepository as never,
      sequelize as never,
    );
    return { service, flowModel, stepEventModel, flowRepository };
  }

  it('marca como abandonado el flujo sin actividad posterior al corte', async () => {
    const { service, flowRepository } = build([{ id: '1' }]);

    const result = await service.markAbandonedFlows({ tenantId: 't1' });

    expect(result).toMatchObject({ evaluated: 1, abandoned: 1 });
    expect(flowRepository.closeOnboardingFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1' }),
      { completionStatus: 'abandoned', closedAt: expect.any(Date) },
      { transaction: {} },
    );
  });

  /** El corte por fecha de INICIO no alcanza: `startedAt` dice cuándo empezó, no cuándo se detuvo. */
  it('respeta el flujo antiguo que registró actividad reciente', async () => {
    const { service, flowRepository } = build([{ id: '1' }, { id: '2' }], [{ onboardingFlowId: '2' }]);

    const result = await service.markAbandonedFlows({ tenantId: 't1' });

    expect(result).toMatchObject({ evaluated: 2, abandoned: 1 });
    expect(flowRepository.closeOnboardingFlow).toHaveBeenCalledTimes(1);
    expect(flowRepository.closeOnboardingFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('no abre transacción cuando no hay nada que cerrar', async () => {
    const { service, flowRepository } = build([{ id: '1' }], [{ onboardingFlowId: '1' }]);

    const result = await service.markAbandonedFlows({ tenantId: 't1' });

    expect(result).toMatchObject({ evaluated: 1, abandoned: 0 });
    expect(flowRepository.closeOnboardingFlow).not.toHaveBeenCalled();
  });

  it('aplica el umbral de días recibido al buscar candidatos', async () => {
    const { service, flowModel } = build([]);

    const result = await service.markAbandonedFlows({ tenantId: 't1', olderThanDays: 7, limit: 10 });

    const where = (flowModel.findAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; limit: number };
    expect(where.limit).toBe(10);
    expect(where.where).toMatchObject({ tenantId: 't1', completionStatus: 'in_progress' });
    const threshold = new Date(result.thresholdDate).getTime();
    expect(Date.now() - threshold).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 5_000);
  });
});
