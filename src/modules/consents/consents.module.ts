import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConsentDocumentModel, ConsentEventModel, CustomerConsentModel } from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ConsentsController } from './consents.controller.js';
import { ConsentsRepository } from './consents.repository.js';
import { ConsentsService } from './consents.service.js';

@Module({
  imports: [SequelizeModule.forFeature([ConsentDocumentModel, CustomerConsentModel, ConsentEventModel]), CustomersModule],
  controllers: [ConsentsController],
  providers: [ConsentsRepository, ConsentsService],
})
export class ConsentsModule {}
