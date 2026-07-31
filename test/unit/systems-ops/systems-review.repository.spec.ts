import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { SystemsReviewRepository } from '../../../src/modules/systems-ops/systems-review.repository.js';

/**
 * Cobertura directa de `SystemsReviewRepository` (Fase 1.2 del plan 10/10): cola de revisión con
 * inclusión condicional por `type`, y las 7 mutaciones de revisión (findByPk → mutar → save →
 * registrar evento). Modelos Sequelize mockeados.
 */
describe('SystemsReviewRepository', () => {
  function buildRepo() {
    const make = () => ({
      findAndCountAll: asyncMock().mockResolvedValue({ rows: [], count: 0 } as never),
      findByPk: asyncMock(),
      create: asyncMock(),
    });
    const models = {
      endpoint: make(),
      dataEntity: make(),
      dataImpact: make(),
      fieldImpact: make(),
      dataField: make(),
      endpointTool: make(),
      reviewEvent: make(),
    };
    const repo = new SystemsReviewRepository(
      models.endpoint as never,
      models.dataEntity as never,
      models.dataImpact as never,
      models.fieldImpact as never,
      models.dataField as never,
      models.endpointTool as never,
      models.reviewEvent as never,
    );
    return { repo, models };
  }

  describe('listReviewQueue', () => {
    it('con type=all consulta las 6 fuentes', async () => {
      const { repo, models } = buildRepo();
      await repo.listReviewQueue({ type: 'all', reviewStatus: 'pending', page: 1, limit: 20 } as never);
      expect(models.endpoint.findAndCountAll).toHaveBeenCalled();
      expect(models.dataEntity.findAndCountAll).toHaveBeenCalled();
      expect(models.dataImpact.findAndCountAll).toHaveBeenCalled();
      expect(models.fieldImpact.findAndCountAll).toHaveBeenCalled();
      expect(models.dataField.findAndCountAll).toHaveBeenCalled();
      expect(models.endpointTool.findAndCountAll).toHaveBeenCalled();
    });

    it('con type=endpoints solo consulta endpoints y calcula offset', async () => {
      const { repo, models } = buildRepo();
      await repo.listReviewQueue({ type: 'endpoints', reviewStatus: 'pending', page: 3, limit: 10 } as never);
      expect(models.endpoint.findAndCountAll).toHaveBeenCalled();
      expect(models.dataEntity.findAndCountAll).not.toHaveBeenCalled();
      expect(callArg<CallArgRecord>(models.endpoint.findAndCountAll, 0, 0).offset).toBe(20);
    });
  });

  describe('updateEndpointReview', () => {
    it('devuelve null cuando el endpoint no existe (sin registrar evento)', async () => {
      const { repo, models } = buildRepo();
      (models.endpoint.findByPk as jest.Mock).mockResolvedValue(null as never);
      const result = await repo.updateEndpointReview('e1', { reviewStatus: 'approved' } as never, 'u1', 'admin', 't1');
      expect(result).toBeNull();
      expect(models.reviewEvent.create).not.toHaveBeenCalled();
    });

    it('muta reviewStatus + confidence, guarda y registra el evento de revisión', async () => {
      const { repo, models } = buildRepo();
      const save = jest.fn(async () => ({ id: 'e1', reviewStatus: 'approved' }));
      const row = { reviewStatus: 'pending', confidenceLevel: 'low', save } as never;
      (models.endpoint.findByPk as jest.Mock).mockResolvedValue(row as never);
      (models.reviewEvent.create as jest.Mock).mockResolvedValue({} as never);
      await repo.updateEndpointReview('e1', { reviewStatus: 'approved', confidenceLevel: 'high' } as never, 'u1', 'admin', 't1');
      expect((row as { reviewStatus: string; confidenceLevel: string; updatedBy: string }).reviewStatus).toBe('approved');
      expect((row as { confidenceLevel: string }).confidenceLevel).toBe('high');
      expect((row as { updatedBy: string }).updatedBy).toBe('u1');
      expect(save).toHaveBeenCalled();
      const event = (models.reviewEvent.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(event).toMatchObject({
        targetType: 'endpoint',
        targetId: 'e1',
        previousStatus: 'pending',
        newStatus: 'approved',
        newConfidence: 'high',
      });
    });

    it('sin confidenceLevel en la decisión, el evento hereda el confidence previo', async () => {
      const { repo, models } = buildRepo();
      const save = jest.fn(async () => ({}));
      const row = { reviewStatus: 'pending', confidenceLevel: 'medium', save } as never;
      (models.endpoint.findByPk as jest.Mock).mockResolvedValue(row as never);
      (models.reviewEvent.create as jest.Mock).mockResolvedValue({} as never);
      await repo.updateEndpointReview('e1', { reviewStatus: 'rejected' } as never, null, 'reviewer', null);
      expect((row as { confidenceLevel: string }).confidenceLevel).toBe('medium');
      expect(callArg<CallArgRecord>(models.reviewEvent.create, 0, 0).newConfidence).toBe('medium');
    });
  });

  describe('updateDataColumnReview', () => {
    it('marca detectedFrom=manual, escribe operationalNotes y registra data_column', async () => {
      const { repo, models } = buildRepo();
      const save = jest.fn(async () => ({}));
      const row = { reviewStatus: 'pending', confidenceLevel: 'low', save } as never;
      (models.dataField.findByPk as jest.Mock).mockResolvedValue(row as never);
      (models.reviewEvent.create as jest.Mock).mockResolvedValue({} as never);
      await repo.updateDataColumnReview('col1', { reviewStatus: 'approved', notes: 'ok' } as never, 'u1', 'admin', 't1');
      expect((row as { detectedFrom: string; operationalNotes: string }).detectedFrom).toBe('manual');
      expect((row as { operationalNotes: string }).operationalNotes).toBe('ok');
      expect(callArg<CallArgRecord>(models.reviewEvent.create, 0, 0).targetType).toBe('data_column');
    });
  });

  describe('updateToolRequirementReview', () => {
    it('devuelve null cuando no existe', async () => {
      const { repo, models } = buildRepo();
      (models.endpointTool.findByPk as jest.Mock).mockResolvedValue(null as never);
      const result = await repo.updateToolRequirementReview('r1', { reviewStatus: 'approved' } as never, 'u1', 'admin', 't1');
      expect(result).toBeNull();
    });
  });

  describe('resto de mutaciones de revisión (data-entity / data-impact / field-impact / tool)', () => {
    const cases = [
      { method: 'updateDataEntityReview', model: 'dataEntity', targetType: 'data_entity' },
      { method: 'updateDataImpactReview', model: 'dataImpact', targetType: 'data_impact' },
      { method: 'updateFieldImpactReview', model: 'fieldImpact', targetType: 'field_impact' },
      { method: 'updateToolRequirementReview', model: 'endpointTool', targetType: 'tool_requirement' },
    ] as const;

    for (const c of cases) {
      it(`${c.method}: null si no existe; si existe muta/guarda/registra ${c.targetType}`, async () => {
        const nullCase = buildRepo();
        (nullCase.models as unknown as Record<string, { findByPk: jest.Mock }>)[c.model].findByPk.mockResolvedValue(null as never);
        const repoNull = nullCase.repo as unknown as Record<
          string,
          (id: string, d: unknown, a: unknown, r: unknown, t: unknown) => Promise<unknown>
        >;
        expect(await repoNull[c.method]('x', { reviewStatus: 'approved' }, 'u1', 'admin', 't1')).toBeNull();

        const okCase = buildRepo();
        const save = jest.fn(async () => ({ id: 'x' }));
        const row = { reviewStatus: 'pending', confidenceLevel: 'low', save } as Record<string, unknown>;
        (okCase.models as unknown as Record<string, { findByPk: jest.Mock }>)[c.model].findByPk.mockResolvedValue(row as never);
        (okCase.models.reviewEvent.create as jest.Mock).mockResolvedValue({} as never);
        const repoOk = okCase.repo as unknown as Record<
          string,
          (id: string, d: unknown, a: unknown, r: unknown, t: unknown) => Promise<unknown>
        >;
        await repoOk[c.method]('x', { reviewStatus: 'approved', confidenceLevel: 'high', notes: 'ok' }, 'u1', 'admin', 't1');
        expect(row.reviewStatus).toBe('approved');
        expect(save).toHaveBeenCalledTimes(1);
        expect((okCase.models.reviewEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({
          targetType: c.targetType,
          newStatus: 'approved',
          notes: 'ok',
        });
      });
    }
  });

  it('listReviewQueue con type=tool_requirements solo consulta endpointTool', async () => {
    const { repo, models } = buildRepo();
    await repo.listReviewQueue({ type: 'tool_requirements', reviewStatus: 'pending', page: 1, limit: 20 } as never);
    expect(models.endpointTool.findAndCountAll).toHaveBeenCalled();
    expect(models.endpoint.findAndCountAll).not.toHaveBeenCalled();
  });
});
