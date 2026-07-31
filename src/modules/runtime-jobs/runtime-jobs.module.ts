/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AddressGpsObservationModel,
  CustomerSessionModel,
  DataQualityIssueModel,
  DeviceSnapshotModel,
  FormFieldInteractionEventModel,
  OperationalAuditLogModel,
  IdempotencyKeyModel,
  OutboxEventModel,
  RetentionPolicyModel,
  SystemJobRunModel,
  TenantModel,
} from '../../database/models/index.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RuntimeJobsController } from './runtime-jobs.controller.js';
import { RuntimeJobsSchedulerService } from './runtime-jobs-scheduler.service.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';
import { RuntimeMaintenanceJobsService } from './runtime-maintenance-jobs.service.js';
import { JobRunRecorderService } from './job-run-recorder.service.js';

@Module({
  imports: [
    EventsModule,
    // El barrido de notificaciones atascadas (hallazgo A-03) reutiliza el MISMO orquestador que la
    // entrega normal, para que un reintento no pueda divergir del camino feliz.
    NotificationsModule,
    SequelizeModule.forFeature([
      SystemJobRunModel,
      OutboxEventModel,
      CustomerSessionModel,
      RetentionPolicyModel,
      DataQualityIssueModel,
      OperationalAuditLogModel,
      AddressGpsObservationModel,
      DeviceSnapshotModel,
      FormFieldInteractionEventModel,
      IdempotencyKeyModel,
      TenantModel,
    ]),
  ],
  controllers: [RuntimeJobsController],
  providers: [JobRunRecorderService, RuntimeJobsService, RuntimeMaintenanceJobsService, RuntimeJobsSchedulerService],
})
export class RuntimeJobsModule {}
