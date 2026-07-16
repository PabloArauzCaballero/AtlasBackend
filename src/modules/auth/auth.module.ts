import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AuthCredentialModel,
  AuthEventModel,
  AuthOneTimeCodeModel,
  AuthRefreshTokenModel,
  InternalUserModel,
  OperationalAuditLogModel,
  PlatformUserModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { MailSenderModule } from '../mail-sender/mail-sender.module.js';
import { AuthController } from './auth.controller.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthPasswordResetService } from './auth-password-reset.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      AuthCredentialModel,
      AuthRefreshTokenModel,
      AuthOneTimeCodeModel,
      InternalUserModel,
      PlatformUserModel,
      AuthEventModel,
      OperationalAuditLogModel,
    ]),
    CustomersModule,
    MailSenderModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthActorResolverService, AuthPasswordResetService, AuthRepository],
  exports: [AuthService, AuthRepository],
})
export class AuthModule {}
