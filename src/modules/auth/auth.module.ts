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
  MerchantUserModel,
  OperationalAuditLogModel,
  PlatformUserModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { MailSenderModule } from '../mail-sender/mail-sender.module.js';
import { AuthController } from './auth.controller.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthPasswordResetService } from './auth-password-reset.service.js';
import { AuthSecondFactorService } from './auth-second-factor.service.js';
import { AuthTokenIssuerService } from './auth-token-issuer.service.js';
import { AuthOneTimeCodeRepository } from './auth-one-time-code.repository.js';
import { AuthRepository } from './auth.repository.js';
import { MerchantActorRepository } from './merchant-actor.repository.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      AuthCredentialModel,
      AuthRefreshTokenModel,
      AuthOneTimeCodeModel,
      InternalUserModel,
      PlatformUserModel,
      MerchantUserModel,
      AuthEventModel,
      OperationalAuditLogModel,
    ]),
    CustomersModule,
    MailSenderModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthActorResolverService,
    AuthPasswordResetService,
    AuthSecondFactorService,
    AuthTokenIssuerService,
    AuthRepository,
    AuthOneTimeCodeRepository,
    MerchantActorRepository,
  ],
  // `AuthSecondFactorService` se exporta para que el perfil de un usuario interno pueda informar si
  // su acceso lleva de verdad un segundo factor, sin duplicar esa política fuera de aquí.
  // `AuthTokenIssuerService` se exporta porque el registro de un cliente abre su sesión dentro de la
  // transacción del alta, sin volver a pasar por el login.
  exports: [
    AuthService,
    AuthRepository,
    AuthOneTimeCodeRepository,
    AuthSecondFactorService,
    AuthTokenIssuerService,
    MerchantActorRepository,
  ],
})
export class AuthModule {}
