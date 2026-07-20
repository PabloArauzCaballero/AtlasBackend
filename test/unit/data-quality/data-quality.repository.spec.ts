import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Op } from 'sequelize';
import { DataQualityRepository } from '../../../src/modules/data-quality/data-quality.repository.js';
import { decodeCursor, encodeCursor } from '../../../src/common/utils/pagination/cursor-pagination.util.js';

/**
 * Cobertura de `findIssuesWithCursor`, la variante de paginación por cursor de data-quality.
 */

function makeRow(id: string, detectedAt: string) {
  return { id, detectedAt: new Date(detectedAt) };
}

function buildRepository(
  issueModelMock: { findAll: jest.Mock; findAndCountAll?: jest.Mock },
  ruleModelMock: { findAll: jest.Mock } = { findAll: jest.fn(async () => []) },
) {
  return new DataQualityRepository(issueModelMock as never, ruleModelMock as never, {} as never, {} as never);
}

describe('DataQualityRepository.findIssuesWithCursor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('primera página: pide limit+1, recorta a limit y arma nextCursor con la última fila', async () => {
    const rows = [
      makeRow('30', '2026-06-30T10:00:00.000Z'),
      makeRow('29', '2026-06-29T10:00:00.000Z'),
      makeRow('28', '2026-06-28T10:00:00.000Z'),
    ];
    const findAll = jest.fn(async () => rows);
    const repository = buildRepository({ findAll });

    const result = await repository.findIssuesWithCursor('tenant-1', { limit: 2 });

    expect(findAll).toHaveBeenCalledTimes(1);
    const callArgs = findAll.mock.calls[0][0] as { limit: number; where: Record<string, unknown> };
    expect(callArgs.limit).toBe(3); // limit + 1
    expect(callArgs.where).toEqual({ tenantId: 'tenant-1' }); // sin cursor todavía

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id)).toEqual(['30', '29']);

    const decoded = decodeCursor(result.nextCursor ?? undefined);
    expect(decoded).toEqual({ createdAt: '2026-06-29T10:00:00.000Z', id: '29' });
  });

  it('última página: cuando vienen <= limit filas, nextCursor es null', async () => {
    const rows = [makeRow('2', '2026-06-02T10:00:00.000Z'), makeRow('1', '2026-06-01T10:00:00.000Z')];
    const findAll = jest.fn(async () => rows);
    const repository = buildRepository({ findAll });

    const result = await repository.findIssuesWithCursor('tenant-1', { limit: 5 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('con un cursor recibido, agrega el filtro de tupla (detected_at, id) al where', async () => {
    const findAll = jest.fn(async () => []);
    const repository = buildRepository({ findAll });
    const cursor = encodeCursor({ createdAt: '2026-06-15T00:00:00.000Z', id: '15' });

    await repository.findIssuesWithCursor('tenant-1', { limit: 10, cursor });

    const callArgs = findAll.mock.calls[0][0] as { where: Record<string, unknown> };
    // El filtro de cursor se agrega bajo una key Symbol (Op.and), invisible a Object.keys();
    // Reflect.ownKeys() sí la incluye. Alcanza con confirmar que se agregó ese filtro además
    // de tenantId, sin reconstruir el operador exacto.
    expect(Reflect.ownKeys(callArgs.where).length).toBeGreaterThan(1);
    expect(callArgs.where.tenantId).toBe('tenant-1');
  });

  it('aplica los filtros opcionales de status/entityType/customerId', async () => {
    const findAll = jest.fn(async () => []);
    const repository = buildRepository({ findAll });

    await repository.findIssuesWithCursor('tenant-1', { limit: 10, status: 'open', entityType: 'customers', customerId: 'cust-1' });

    const callArgs = findAll.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).toMatchObject({ tenantId: 'tenant-1', issueStatus: 'open', targetTable: 'customers', targetRecordId: 'cust-1' });
  });

  it('resuelve severity contra data_quality_rules — antes se ignoraba en silencio, no filtraba nada', async () => {
    const issueFindAll = jest.fn(async () => []);
    const ruleFindAll = jest.fn(async () => [{ id: 'rule-1' }, { id: 'rule-2' }]);
    const repository = buildRepository({ findAll: issueFindAll }, { findAll: ruleFindAll });

    await repository.findIssuesWithCursor('tenant-1', { limit: 10, severity: 'critical' });

    expect(ruleFindAll).toHaveBeenCalledWith(expect.objectContaining({ where: { severity: 'critical' } }));
    const callArgs = issueFindAll.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).toMatchObject({ tenantId: 'tenant-1', qualityRuleId: { [Op.in]: ['rule-1', 'rule-2'] } });
  });

  it('cuando ninguna regla tiene esa severity, devuelve vacío sin consultar issues', async () => {
    const issueFindAll = jest.fn(async () => []);
    const ruleFindAll = jest.fn(async () => []);
    const repository = buildRepository({ findAll: issueFindAll }, { findAll: ruleFindAll });

    const result = await repository.findIssuesWithCursor('tenant-1', { limit: 10, severity: 'nonexistent' });

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(issueFindAll).not.toHaveBeenCalled();
  });
});

describe('DataQualityRepository — findIssues / finders / mutaciones', () => {
  function buildFull() {
    const issueModel = { findAll: jest.fn(), findAndCountAll: jest.fn(), findOne: jest.fn() };
    const ruleModel = { findAll: jest.fn(async () => []) };
    const auditModel = { create: jest.fn(async () => ({ id: 'a' })) };
    const dataChangeLogModel = { create: jest.fn(async () => ({ id: 'd' })) };
    const repo = new DataQualityRepository(issueModel as never, ruleModel as never, auditModel as never, dataChangeLogModel as never);
    return { repo, issueModel, ruleModel, auditModel, dataChangeLogModel };
  }

  it('findIssues (offset) arma el where con status/entityType/customerId y pagina', async () => {
    const { repo, issueModel } = buildFull();
    (issueModel.findAndCountAll as jest.Mock).mockResolvedValueOnce({ rows: [{ id: '1' }], count: 1 } as never);
    const res = await repo.findIssues('t1', { status: 'open', entityType: 'customers', customerId: 'c1', limit: 20, page: 1 } as never);
    const args = (issueModel.findAndCountAll as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; limit: number };
    expect(args.where).toMatchObject({ tenantId: 't1', issueStatus: 'open', targetTable: 'customers', targetRecordId: 'c1' });
    expect(res.rows).toHaveLength(1);
    expect(res.meta).toBeDefined();
  });

  it('findIssues corta temprano (sin consultar issues) cuando la severity no matchea ninguna regla', async () => {
    const { repo, issueModel, ruleModel } = buildFull();
    (ruleModel.findAll as jest.Mock).mockResolvedValueOnce([] as never);
    const res = await repo.findIssues('t1', { severity: 'critical', limit: 20, page: 1 } as never);
    expect(res.rows).toEqual([]);
    expect(issueModel.findAndCountAll).not.toHaveBeenCalled();
  });

  it('findRulesByIds corta temprano con lista vacía; con ids usa Op.in', async () => {
    const { repo, ruleModel } = buildFull();
    expect(await repo.findRulesByIds([])).toEqual([]);
    (ruleModel.findAll as jest.Mock).mockResolvedValueOnce([{ id: 'r1' }] as never);
    await repo.findRulesByIds(['r1', 'r2']);
    expect((ruleModel.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { id: { [Op.in]: ['r1', 'r2'] } } });
  });

  it('findIssueById filtra por tenant + id', async () => {
    const { repo, issueModel } = buildFull();
    (issueModel.findOne as jest.Mock).mockResolvedValueOnce(null as never);
    await repo.findIssueById('t1', '9');
    expect((issueModel.findOne as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', id: '9' } });
  });

  it('resolveIssue fija estado/resolvedAt/notas y guarda en la transacción', async () => {
    const { repo } = buildFull();
    const save = jest.fn(async () => ({}));
    const issue = { save } as never;
    const resolvedAt = new Date('2026-01-01T00:00:00.000Z');
    await repo.resolveIssue(issue, { status: 'resolved', notes: 'ok', resolvedAt }, { transaction: 'tx' as never });
    expect((issue as { issueStatus: string }).issueStatus).toBe('resolved');
    expect((issue as { resolutionNotes: string }).resolutionNotes).toBe('ok');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('createAudit mapea el payload y fija targetType data_quality_issue', async () => {
    const { repo, auditModel } = buildFull();
    await repo.createAudit(
      {
        tenantId: 't1',
        actorType: 'internal_operator',
        actorInternalUserId: 'u',
        actionCode: 'resolve',
        targetId: '9',
        payload: { a: 1 },
        happenedAt: new Date(),
      },
      { transaction: 'tx' as never },
    );
    expect((auditModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      targetType: 'data_quality_issue',
      targetId: '9',
      payloadJson: { a: 1 },
      actorPlatformUserId: null,
    });
  });

  it('createDataChange registra el cambio de tipo resolve sobre data_quality_issues', async () => {
    const { repo, dataChangeLogModel } = buildFull();
    await repo.createDataChange(
      { tenantId: 't1', issueId: '9', actorType: 'internal_operator', actorInternalUserId: 'u', reason: 'fix', happenedAt: new Date() },
      {},
    );
    expect((dataChangeLogModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      tableName: 'data_quality_issues',
      recordId: '9',
      changeType: 'resolve',
      changeReason: 'fix',
    });
  });
});
