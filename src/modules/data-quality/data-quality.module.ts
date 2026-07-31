/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje.
 * @system administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DataChangeLogModel, DataQualityIssueModel, DataQualityRuleModel, OperationalAuditLogModel } from '../../database/models/index.js';
import { DataQualityController } from './data-quality.controller.js';
import { DataQualityRepository } from './data-quality.repository.js';
import { DataQualityService } from './data-quality.service.js';

@Module({
  imports: [SequelizeModule.forFeature([DataQualityIssueModel, DataQualityRuleModel, OperationalAuditLogModel, DataChangeLogModel])],
  controllers: [DataQualityController],
  providers: [DataQualityService, DataQualityRepository],
})
export class DataQualityModule {}
