import { Module } from '@nestjs/common';
import { SchemaManagementController } from './schema-management.controller.js';
import { SchemaManagementService } from './services/schema-management.service.js';
import { SchemaManagementValidationService } from './services/schema-management-validation.service.js';
import { SchemaManagementRepository } from './schema-management.repository.js';

@Module({
  controllers: [SchemaManagementController],
  providers: [SchemaManagementService, SchemaManagementValidationService, SchemaManagementRepository],
  exports: [SchemaManagementService],
})
export class SchemaManagementModule {}
