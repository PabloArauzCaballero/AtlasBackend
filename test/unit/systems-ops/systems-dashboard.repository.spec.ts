import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { SystemsDashboardRepository } from '../../../src/modules/systems-ops/systems-dashboard.repository.js';

/**
 * Cobertura directa de `SystemsDashboardRepository` (Fase 1.2 del plan 10/10): conteos agregados del
 * panel (Promise.all de counts) y la suma de revisiones pendientes sobre 5 fuentes. Modelos mockeados.
 */
describe('SystemsDashboardRepository', () => {
  function buildRepo() {
    const make = (n: number) => ({ count: jest.fn(async (..._args: unknown[]) => n) });
    const endpointModel = make(3);
    const toolModel = make(4);
    const dataEntityModel = make(5);
    const suiteModel = make(6);
    const stressProfileModel = make(7);
    const actionLogModel = make(8);
    const dataImpactModel = make(9);
    const fieldImpactModel = make(10);
    const endpointToolModel = make(11);
    const repo = new SystemsDashboardRepository(
      endpointModel as never,
      toolModel as never,
      dataEntityModel as never,
      suiteModel as never,
      stressProfileModel as never,
      actionLogModel as never,
      dataImpactModel as never,
      fieldImpactModel as never,
      endpointToolModel as never,
    );
    return { repo, endpointModel, stressProfileModel, actionLogModel };
  }

  it('countPendingReviews suma los NEEDS_REVIEW de las 5 fuentes', async () => {
    const { repo } = buildRepo();
    // endpoint(3) + dataEntity(5) + dataImpact(9) + fieldImpact(10) + endpointTool(11) = 38
    const total = await repo.countPendingReviews();
    expect(total).toBe(38);
  });

  it('getDashboardCounts arma el objeto con cada conteo y filtra stress activos + logs 24h', async () => {
    const { repo, stressProfileModel, actionLogModel } = buildRepo();
    const counts = await repo.getDashboardCounts();
    expect(counts).toEqual({
      endpoints: 3,
      tools: 4,
      dataEntities: 5,
      testSuites: 6,
      pendingReviews: 38,
      stressProfiles: 7,
      actionLogs24h: 8,
    });
    expect((stressProfileModel.count as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { isEnabled: true } });
    const logWhere = (actionLogModel.count as jest.Mock).mock.calls[0][0] as { where: { occurredAt: Record<symbol, Date> } };
    expect(logWhere.where.occurredAt[Op.gte]).toBeInstanceOf(Date);
  });
});
