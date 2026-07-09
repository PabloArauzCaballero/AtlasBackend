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
import { InternalPermissionsGuard } from './guards/internal-permissions.guard.js';
import { InternalAccessCatalogController } from './internal-access-catalog.controller.js';
import { InternalAccessCatalogRepository } from './internal-access-catalog.repository.js';
import { InternalAccessCatalogService } from './internal-access-catalog.service.js';
import { InternalAuthController } from './internal-auth.controller.js';
import { InternalAuthService } from './internal-auth.service.js';
import { InternalRbacRepository } from './internal-rbac.repository.js';
import { InternalUsersController } from './internal-users.controller.js';
import { InternalUsersService } from './internal-users.service.js';

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
    InternalAccessCatalogService,
    InternalRbacRepository,
    InternalAccessCatalogRepository,
    InternalPermissionsGuard,
  ],
  exports: [InternalUsersService, InternalAccessCatalogService, InternalRbacRepository, InternalAccessCatalogRepository],
})
export class InternalUsersModule {}
