import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerDeviceLinkModel,
  CustomerSessionModel,
  DeviceModel,
  DeviceSnapshotModel,
  GlobalDeviceFingerprintModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsRepository } from './sessions.repository.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      GlobalDeviceFingerprintModel,
      DeviceModel,
      CustomerDeviceLinkModel,
      CustomerSessionModel,
      DeviceSnapshotModel,
    ]),
    CustomersModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsRepository, SessionsService],
})
export class SessionsModule {}
