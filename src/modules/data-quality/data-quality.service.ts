import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { DataQualityRepository } from './data-quality.repository.js';
import { DataQualityQueryDto, DataQualityIssueParamsDto, ResolveDataQualityIssueDto } from './data-quality.schemas.js';

@Injectable()
export class DataQualityService {
  constructor(
    private readonly repository: DataQualityRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async listIssues(tenantId: string, query: DataQualityQueryDto) {
    const result = await this.repository.findIssues(tenantId, query);
    const ruleIds = [...new Set(result.rows.map((issue) => issue.qualityRuleId).filter((id): id is string => id !== null))];
    const rules = await this.repository.findRulesByIds(ruleIds);
    const ruleById = new Map(rules.map((rule) => [String(rule.id), rule]));
    return {
      items: result.rows.map((issue) => {
        const rule = issue.qualityRuleId ? ruleById.get(String(issue.qualityRuleId)) : undefined;
        return {
          issueId: String(issue.id),
          severity: rule?.severity ?? null,
          entityType: issue.targetTable,
          entityId: issue.targetRecordId,
          issueCode: rule?.ruleCode ?? null,
          status: issue.issueStatus,
          detectedAt: issue.detectedAt?.toISOString() ?? null,
          resolvedAt: issue.resolvedAt?.toISOString() ?? null,
        };
      }),
      meta: result.meta,
    };
  }

  async resolveIssue(input: {
    tenantId: string;
    params: DataQualityIssueParamsDto;
    body: ResolveDataQualityIssueDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      const issue = await this.repository.findIssueById(input.tenantId, input.params.issueId);
      if (!issue) throw new NotFoundException('DATA_QUALITY_ISSUE_NOT_FOUND');
      if (issue.resolvedAt) throw new ConflictException('DATA_QUALITY_ISSUE_ALREADY_RESOLVED');
      await this.repository.resolveIssue(
        issue,
        { status: input.body.resolution, notes: `${input.body.reasonCode}: ${input.body.notes}`, resolvedAt: now },
        { transaction },
      );
      await this.repository.createAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'data_quality.issue.resolve',
          targetId: input.params.issueId,
          payload: { resolution: input.body.resolution, reasonCode: input.body.reasonCode },
          happenedAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.tenantId,
          issueId: input.params.issueId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          reason: input.body.reasonCode,
          happenedAt: now,
        },
        { transaction },
      );
      return { issueId: input.params.issueId, status: input.body.resolution };
    });
  }
}
