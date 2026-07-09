import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemActionLogModel } from '../../database/models/index.js';
import { SystemsActionLogQueryDto } from './systems-ops.schemas.js';
import { buildActionLogWhere } from './systems-repository-where.util.js';

@Injectable()
export class SystemsActionLogRepository {
  constructor(@InjectModel(SystemActionLogModel) private readonly actionLogModel: typeof SystemActionLogModel) {}

  async listActionLogs(query: SystemsActionLogQueryDto) {
    const result = await this.actionLogModel.findAndCountAll({
      where: buildActionLogWhere(query),
      order: [['occurredAt', 'DESC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findActionLogsByRequest(requestId: string): Promise<SystemActionLogModel[]> {
    return this.actionLogModel.findAll({ where: { requestId }, order: [['occurredAt', 'DESC']] } as FindOptions);
  }
}
