/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza aporta trazabilidad verificable de acciones y cambios para investigación, cumplimiento y soporte.
 * @system consolida consultas y persistencia de eventos de auditoría sin exponer modelos ORM al transporte.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AuthEventModel,
  ConsentEventModel,
  CustomerActionLogModel,
  CustomerConsentModel,
  CustomerStatusEventModel,
  DataChangeLogModel,
  FraudCaseEventModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  ManualReviewEventModel,
  OperationalAuditLogModel,
  SystemActionLogModel,
  SystemEndpointCatalogModel,
} from '../../database/models/index.js';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';
import { HttpActionLogService } from './http-action-log.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      OperationalAuditLogModel,
      SystemActionLogModel,
      SystemEndpointCatalogModel,
      DataChangeLogModel,
      CustomerStatusEventModel,
      CustomerActionLogModel,
      AuthEventModel,
      ConsentEventModel,
      ManualReviewEventModel,
      FraudCaseEventModel,
      CustomerConsentModel,
      ManualReviewCaseModel,
      FraudCaseModel,
    ]),
  ],
  controllers: [AuditController],
  providers: [AuditService, AuditRepository, HttpActionLogService],
  exports: [HttpActionLogService],
})
export class AuditModule {}
