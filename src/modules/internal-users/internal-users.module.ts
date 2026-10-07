/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AuthCredentialModel,
  InternalPermissionModel,
  InternalRoleModel,
  InternalRolePermissionModel,
  InternalUserModel,
  InternalUserRoleModel,
  OperationalAuditLogModel,
} from '../../database/models/index.js';
import { AuthModule } from '../auth/auth.module.js';
import { InternalPermissionsGuard } from '../../common/guards/internal-permissions.guard.js';
import { INTERNAL_PERMISSIONS_CHECKER } from '../../common/guards/internal-permissions.port.js';
import { InternalAccessCatalogController } from './internal-access-catalog.controller.js';
import { InternalAccessCatalogRepository } from './internal-access-catalog.repository.js';
import { InternalAccessCatalogService } from './internal-access-catalog.service.js';
import { InternalAuthController } from './internal-auth.controller.js';
import { InternalAuthService } from './internal-auth.service.js';
import { InternalRbacRepository } from './internal-rbac.repository.js';
import { InternalPermissionHoldersRepository } from './internal-permission-holders.repository.js';
import { InternalUsersController } from './internal-users.controller.js';
import { InternalUsersService } from './internal-users.service.js';
import { InternalUserLockService } from './internal-user-lock.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      InternalUserModel,
      InternalRoleModel,
      InternalPermissionModel,
      InternalRolePermissionModel,
      InternalUserRoleModel,
      AuthCredentialModel,
      OperationalAuditLogModel,
    ]),
    AuthModule,
  ],
  controllers: [InternalAuthController, InternalUsersController, InternalAccessCatalogController],
  providers: [
    InternalAuthService,
    InternalUsersService,
    InternalUserLockService,
    InternalAccessCatalogService,
    InternalRbacRepository,
    InternalPermissionHoldersRepository,
    InternalAccessCatalogRepository,
    InternalPermissionsGuard,
    { provide: INTERNAL_PERMISSIONS_CHECKER, useExisting: InternalRbacRepository },
  ],
  exports: [
    INTERNAL_PERMISSIONS_CHECKER,
    InternalUsersService,
    InternalAccessCatalogService,
    InternalRbacRepository,
    InternalPermissionHoldersRepository,
    InternalAccessCatalogRepository,
  ],
})
export class InternalUsersModule {}
