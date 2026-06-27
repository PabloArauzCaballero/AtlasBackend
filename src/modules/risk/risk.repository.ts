import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { RiskAssessmentResultModel } from '../../database/models/index.js';

@Injectable()
export class RiskRepository {
  constructor(
    @InjectModel(RiskAssessmentResultModel)
    private readonly riskAssessmentResultModel: typeof RiskAssessmentResultModel,
  ) {}

  findLatestCustomerRiskResult(tenantId: string, customerId: string): Promise<RiskAssessmentResultModel | null> {
    return this.riskAssessmentResultModel.findOne({
      where: { tenantId, customerId },
      order: [['decidedAt', 'DESC'], ['id', 'DESC']],
    } as FindOptions);
  }
}
