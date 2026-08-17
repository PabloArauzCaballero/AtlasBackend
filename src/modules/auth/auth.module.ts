/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
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
import { AuthSecondFactorService } from './auth-second-factor.service.js';
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
  providers: [AuthService, AuthActorResolverService, AuthPasswordResetService, AuthSecondFactorService, AuthRepository],
  // `AuthSecondFactorService` se exporta para que el perfil de un usuario interno pueda informar si
  // su acceso lleva de verdad un segundo factor, sin duplicar esa política fuera de aquí.
  exports: [AuthService, AuthRepository, AuthSecondFactorService],
})
export class AuthModule {}
