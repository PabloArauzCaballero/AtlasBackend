import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuthCredentialModel, AuthRefreshTokenModel, InternalUserModel, PlatformUserModel } from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([AuthCredentialModel, AuthRefreshTokenModel, InternalUserModel, PlatformUserModel]),
    CustomersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService, AuthRepository],
})
export class AuthModule {}
