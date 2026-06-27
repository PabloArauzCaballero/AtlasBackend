import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, Op, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { FraudCaseModel, ManualReviewCaseModel } from '../../database/models/index.js';
import { ListFraudCasesQueryDto, ListManualReviewCasesQueryDto } from './operations.schemas.js';

@Injectable()
export class OperationsRepository {
  constructor(
    @InjectModel(ManualReviewCaseModel) private readonly manualReviewCaseModel: typeof ManualReviewCaseModel,
    @InjectModel(FraudCaseModel) private readonly fraudCaseModel: typeof FraudCaseModel,
  ) {}

  async findManualReviewCases(tenantId: string, query: ListManualReviewCasesQueryDto) {
    const where: WhereOptions = {
      tenantId,
      deleted: { [Op.ne]: true },
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const result = await this.manualReviewCaseModel.findAndCountAll({
      where,
      order: [['openedAt', 'DESC'], ['id', 'DESC']],
      limit: query.limit,
      offset: toOffset({ page: query.page, limit: query.limit }),
    } as FindAndCountOptions);

    return {
      rows: result.rows,
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, result.count),
    };
  }

  async findFraudCases(tenantId: string, query: ListFraudCasesQueryDto) {
    const where: WhereOptions = {
      tenantId,
      deleted: { [Op.ne]: true },
      ...(query.status ? { caseStatus: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const result = await this.fraudCaseModel.findAndCountAll({
      where,
      order: [['openedAt', 'DESC'], ['id', 'DESC']],
      limit: query.limit,
      offset: toOffset({ page: query.page, limit: query.limit }),
    } as FindAndCountOptions);

    return {
      rows: result.rows,
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, result.count),
    };
  }
}
