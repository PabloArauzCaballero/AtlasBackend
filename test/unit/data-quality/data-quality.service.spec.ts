import { describe, expect, it, jest } from '@jest/globals';
import { DataQualityService } from '../../../src/modules/data-quality/data-quality.service.js';

/**
 * ATLAS-AUDIT (auditoría #13, `data-quality`): `listIssues` hardcodeaba `severity: null` y
 * `issueCode: issue.issueStatus` (duplicando el campo `status`) en vez de resolver esos dos
 * campos contra `data_quality_rules` (via `quality_rule_id`), donde realmente viven. Este test
 * cubre el mapeo correcto tras el fix.
 */
describe('DataQualityService.listIssues', () => {
  function buildService() {
    const repository = {
      findIssues: jest.fn(),
      findRulesByIds: jest.fn(),
    };
    const sequelize = { transaction: jest.fn() };
    const service = new DataQualityService(repository as never, sequelize as never);
    return { service, repository };
  }

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
});
