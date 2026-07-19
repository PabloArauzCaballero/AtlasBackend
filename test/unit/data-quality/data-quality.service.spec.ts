import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataQualityService } from '../../../src/modules/data-quality/data-quality.service.js';

/**
 * `DataQualityService`: `listIssues` resuelve severity/issueCode desde data_quality_rules; `resolveIssue`
 * corre en transacción con guardas (NotFound / already-resolved) y escribe issue + audit + data-change.
 */
describe('DataQualityService', () => {
  function buildService() {
    const repository = {
      findIssues: jest.fn(),
      findRulesByIds: jest.fn(),
      findIssueById: jest.fn(),
      resolveIssue: jest.fn(async () => undefined),
      createAudit: jest.fn(async () => undefined),
      createDataChange: jest.fn(async () => undefined),
    };
    const sequelize = { transaction: jest.fn(async (cb: (tx: string) => unknown) => cb('tx')) };
    const service = new DataQualityService(repository as never, sequelize as never);
    return { service, repository };
  }

  const resolveInput = {
    tenantId: 't1',
    params: { issueId: '7' },
    body: { resolution: 'resolved', reasonCode: 'fixed', notes: 'ok' },
    currentUser: { role: 'compliance_analyst', internalUserId: 'u1' },
    idempotencyKey: 'idem',
  } as never;

  it('resolves severity and issueCode from the joined data_quality_rules row, not from issueStatus', async () => {
    const { service, repository } = buildService();
    (repository.findIssues as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: '1',
          qualityRuleId: 'rule-1',
          targetTable: 'customers',
          targetRecordId: 'c1',
          issueStatus: 'open',
          detectedAt: new Date('2026-01-01T00:00:00.000Z'),
          resolvedAt: null,
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    } as never);
    (repository.findRulesByIds as jest.Mock).mockResolvedValueOnce([{ id: 'rule-1', severity: 'critical', ruleCode: 'missing_identity_doc' }] as never);

    const result = await service.listIssues('t1', {} as never);

    expect(repository.findRulesByIds).toHaveBeenCalledWith(['rule-1']);
    expect(result.items[0]).toMatchObject({ severity: 'critical', issueCode: 'missing_identity_doc', status: 'open' });
  });

  it('returns severity/issueCode null when the issue has no linked rule, instead of throwing', async () => {
    const { service, repository } = buildService();
    (repository.findIssues as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: '1',
          qualityRuleId: null,
          targetTable: 'customers',
          targetRecordId: 'c1',
          issueStatus: 'open',
          detectedAt: new Date('2026-01-01T00:00:00.000Z'),
          resolvedAt: null,
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    } as never);
    (repository.findRulesByIds as jest.Mock).mockResolvedValueOnce([] as never);

    const result = await service.listIssues('t1', {} as never);

    expect(repository.findRulesByIds).toHaveBeenCalledWith([]);
    expect(result.items[0]).toMatchObject({ severity: null, issueCode: null });
  });

  describe('resolveIssue', () => {
    it('lanza NotFound si el issue no existe', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue(null as never);
      await expect(service.resolveIssue(resolveInput)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza Conflict si el issue ya está resuelto', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue({ id: '7', resolvedAt: new Date() } as never);
      await expect(service.resolveIssue(resolveInput)).rejects.toBeInstanceOf(ConflictException);
    });

    it('(feliz) resuelve el issue y escribe audit + data-change en la transacción', async () => {
      const { service, repository } = buildService();
      (repository.findIssueById as jest.Mock).mockResolvedValue({ id: '7', resolvedAt: null } as never);
      const res = await service.resolveIssue(resolveInput);
      expect(res).toEqual({ issueId: '7', status: 'resolved' });
      expect(repository.resolveIssue).toHaveBeenCalledTimes(1);
      expect(repository.createAudit).toHaveBeenCalledTimes(1);
      expect(repository.createDataChange).toHaveBeenCalledTimes(1);
      // las notas combinan reasonCode + notes
      expect((repository.resolveIssue as jest.Mock).mock.calls[0][1]).toMatchObject({ status: 'resolved', notes: 'fixed: ok' });
    });
  });
});
