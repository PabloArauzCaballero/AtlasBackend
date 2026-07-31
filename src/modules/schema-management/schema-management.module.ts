/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.
 */
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
