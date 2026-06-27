import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { RiskAssessmentResultModel } from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { RiskController } from './risk.controller.js';
import { RiskRepository } from './risk.repository.js';
import { RiskService } from './risk.service.js';

@Module({
  imports: [SequelizeModule.forFeature([RiskAssessmentResultModel]), CustomersModule],
  controllers: [RiskController],
  providers: [RiskRepository, RiskService],
})
export class RiskModule {}
