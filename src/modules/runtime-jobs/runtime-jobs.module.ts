import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AddressGpsObservationModel,
  CustomerSessionModel,
  DataQualityIssueModel,
  DeviceSnapshotModel,
  FormFieldInteractionEventModel,
  OperationalAuditLogModel,
  OutboxEventModel,
  RetentionPolicyModel,
  SystemJobRunModel,
} from '../../database/models/index.js';
import { EventsModule } from '../events/events.module.js';
import { RuntimeJobsController } from './runtime-jobs.controller.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';

@Module({
  imports: [
    EventsModule,
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
    ]),
  ],
  controllers: [RuntimeJobsController],
  providers: [RuntimeJobsService],
})
export class RuntimeJobsModule {}
