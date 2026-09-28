/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza gobierna propuestas de estructura sin permitir DDL directo desde el portal.
 * @system valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.
 */
import { Module } from '@nestjs/common';
import { SchemaManagementController } from './schema-management.controller.js';
import { SchemaManagementService } from './services/schema-management.service.js';
import { SchemaManagementValidationService } from './services/schema-management-validation.service.js';
import { SchemaChangeLogRepository } from './schema-change-log.repository.js';
import { SchemaManagementRepository } from './schema-management.repository.js';
import { SchemaChangeAuthorizationGuard } from './schema-change-authorization.guard.js';
import { InternalUsersModule } from '../internal-users/internal-users.module.js';
import { InternalPermissionsGuard } from '../internal-users/guards/internal-permissions.guard.js';

@Module({
  // `InternalUsersModule` aporta `InternalRbacRepository`, que el guard de permisos finos necesita
  // para decidir `governance.schema.*` en sesión interna (hallazgo A4).
  imports: [InternalUsersModule],
  controllers: [SchemaManagementController],
  providers: [
    SchemaManagementService,
    SchemaManagementValidationService,
    SchemaManagementRepository,
    SchemaChangeLogRepository,
    InternalPermissionsGuard,
    SchemaChangeAuthorizationGuard,
  ],
  exports: [SchemaManagementService],
})
export class SchemaManagementModule {}
