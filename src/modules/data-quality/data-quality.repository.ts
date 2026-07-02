import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Transaction, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { DataChangeLogModel, DataQualityIssueModel, OperationalAuditLogModel } from '../../database/models/index.js';
import { DataQualityQueryDto } from './data-quality.schemas.js';

@Injectable()
export class DataQualityRepository {
  constructor(
    @InjectModel(DataQualityIssueModel) private readonly issueModel: typeof DataQualityIssueModel,
    @InjectModel(OperationalAuditLogModel) private readonly auditModel: typeof OperationalAuditLogModel,
    @InjectModel(DataChangeLogModel) private readonly dataChangeLogModel: typeof DataChangeLogModel,
  ) {}

  async findIssues(tenantId: string, query: DataQualityQueryDto) {
    const where: WhereOptions = {
      tenantId,
      ...(query.status ? { issueStatus: query.status } : {}),
      ...(query.entityType ? { targetTable: query.entityType } : {}),
      ...(query.customerId ? { targetRecordId: query.customerId } : {}),
    };
    const result = await this.issueModel.findAndCountAll({
      where,
      order: [
        ['detectedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findIssueById(tenantId: string, issueId: string): Promise<DataQualityIssueModel | null> {
    return this.issueModel.findOne({ where: { tenantId, id: issueId } } as FindOptions);
  }

  async resolveIssue(
    issue: DataQualityIssueModel,
    values: { status: string; notes: string; resolvedAt: Date },
    options: { transaction?: Transaction },
  ): Promise<DataQualityIssueModel> {
    issue.issueStatus = values.status;
    issue.resolvedAt = values.resolvedAt;
    issue.resolutionNotes = values.notes;
    return issue.save({ transaction: options.transaction });
  }

  createAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actionCode: string;
      targetId: string;
      payload: Record<string, unknown>;
      happenedAt: Date;
    },
    options: { transaction?: Transaction },
  ): Promise<OperationalAuditLogModel> {
    return this.auditModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: 'data_quality_issue',
        targetId: values.targetId,
        ipAddress: null,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createDataChange(
    values: { tenantId: string; issueId: string; actorType: string; actorInternalUserId: string | null; reason: string; happenedAt: Date },
    options: { transaction?: Transaction },
  ): Promise<DataChangeLogModel> {
    return this.dataChangeLogModel.create(
      {
        tenantId: values.tenantId,
        tableName: 'data_quality_issues',
        recordId: values.issueId,
        changeType: 'resolve',
        changedByType: values.actorType,
        changedByInternalUserId: values.actorInternalUserId,
        changedByPlatformUserId: null,
        oldValuesHash: null,
        newValuesHash: null,
        changeReason: values.reason,
        changedAt: values.happenedAt,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }
}
