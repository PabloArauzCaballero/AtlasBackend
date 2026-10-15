import { describe, expect, it, jest } from '@jest/globals';
import { RevisionManualRepository } from '../../../src/modules/risk/repositories/revision-manual.repository.js';

/** Cobertura directa del caso de revisión manual y la incidencia de dato faltante que deja una evaluación. */
describe('RevisionManualRepository', () => {
  function buildRepo() {
    const make = () => ({ findOne: jest.fn(), create: jest.fn() });
    const models = { manualReviewCase: make(), dataQualityIssue: make() };
    const revision = new RevisionManualRepository(models.manualReviewCase as never, models.dataQualityIssue as never);
    return { revision, models };
  }

  const now = new Date('2026-01-01T00:00:00.000Z');
  const opts = { transaction: 'tx' as never };
  const firstArg = (m: { create: jest.Mock }) => (m.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;

  it('findManualReviewCaseByExecutionId busca el caso DELEGADO por su ejecución, el más reciente', async () => {
    const { revision, models } = buildRepo();
    (models.manualReviewCase.findOne as jest.Mock).mockResolvedValue({ id: 'mr-9' } as never);

    await expect(revision.findManualReviewCaseByExecutionId('t1', '777', { transaction: 'tx' as never })).resolves.toEqual({
      id: 'mr-9',
    });

    expect(models.manualReviewCase.findOne).toHaveBeenCalledWith({
      where: { tenantId: 't1', decisionExecutionId: '777', deleted: false },
      order: [['id', 'DESC']],
      transaction: 'tx',
    });
  });

  it('closeManualReviewCase cierra el caso con su resolución y guarda dentro de la transacción', async () => {
    const { revision } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => undefined);
    const closedAt = new Date('2026-09-14T20:00:00.000Z');
    const caso = { status: 'open', resolution: null, notes: null, closedAt: null, updatedAtValue: null, save } as never;

    await revision.closeManualReviewCase(caso, { resolution: 'approved', notes: 'ok', closedAt }, { transaction: 'tx' as never });

    expect(caso).toMatchObject({ status: 'closed', resolution: 'approved', notes: 'ok', closedAt, updatedAtValue: closedAt });
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('createManualReviewCase y createDataQualityIssue mapean sus constantes', async () => {
    const { revision, models } = buildRepo();
    await revision.createManualReviewCase(
      {
        tenantId: 't1',
        customerId: 'c1',
        riskAssessmentRunId: 'run1',
        priority: 'high',
        caseType: 'risk',
        notes: 'n',
        decisionExecutionId: null,
        now,
      } as never,
      opts,
    );
    expect(firstArg(models.manualReviewCase)).toMatchObject({ status: 'open', caseType: 'risk', notes: 'n', deleted: false });

    await revision.createDataQualityIssue({ tenantId: 't1', targetRecordId: 'c1', issueCode: 'open', now } as never, opts);
    expect(firstArg(models.dataQualityIssue)).toMatchObject({ targetTable: 'customers', targetRecordId: 'c1', issueStatus: 'open' });
  });
});
