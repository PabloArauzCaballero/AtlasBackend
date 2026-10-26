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
import { CredentialsNotifierService } from './credentials-notifier.service.js';
import { AuthController } from './auth.controller.js';
import { AuthPasswordChangeController } from './auth-password-change.controller.js';
import { AuthPinVerifyController } from './auth-pin-verify.controller.js';
import { AuthPinVerifyService } from './auth-pin-verify.service.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthPasswordChangeRepository } from './auth-password-change.repository.js';
import { AuthPasswordChangeService } from './auth-password-change.service.js';
import { AuthPasswordResetService } from './auth-password-reset.service.js';
import { AuthReauthenticationController } from './auth-reauthentication.controller.js';
import { AuthReauthenticationService } from './auth-reauthentication.service.js';
import { AuthSecondFactorService } from './auth-second-factor.service.js';
import { AuthTokenIssuerService } from './auth-token-issuer.service.js';
import { AuthActorRepository } from './auth-actor.repository.js';
import { AuthCredentialRepository } from './auth-credential.repository.js';
import { AuthEventRepository } from './auth-event.repository.js';
import { AuthOneTimeCodeRepository } from './auth-one-time-code.repository.js';
import { AuthRefreshRotationService } from './auth-refresh-rotation.service.js';
import { AuthRefreshTokensRepository } from './auth-refresh-tokens.repository.js';
import { MerchantActorRepository } from './merchant-actor.repository.js';
import { AuthService } from './auth.service.js';
import { AuthCredentialsService } from './auth-credentials.service.js';

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
  controllers: [AuthController, AuthPasswordChangeController, AuthPinVerifyController, AuthReauthenticationController],
  providers: [
    AuthService,
    AuthCredentialsService,
    AuthActorResolverService,
    AuthPasswordChangeService,
    AuthPinVerifyService,
    AuthPasswordChangeRepository,
    AuthPasswordResetService,
    AuthReauthenticationService,
    AuthSecondFactorService,
    AuthTokenIssuerService,
    AuthActorRepository,
    AuthCredentialRepository,
    AuthEventRepository,
    AuthRefreshTokensRepository,
    AuthRefreshRotationService,
    AuthOneTimeCodeRepository,
    MerchantActorRepository,
    CredentialsNotifierService,
  ],
  // `AuthSecondFactorService` se exporta para que el perfil de un usuario interno pueda informar si
  // su acceso lleva de verdad un segundo factor, sin duplicar esa política fuera de aquí.
  // `AuthTokenIssuerService` se exporta porque el registro de un cliente abre su sesión dentro de la
  // transacción del alta, sin volver a pasar por el login.
  // `AuthReauthenticationService`: la emite el canal del comercio y la exige quien guarda una
  // operación sensible (la cuenta de cobro del expediente).
  exports: [
    AuthService,
    AuthReauthenticationService,
    AuthCredentialRepository,
    AuthOneTimeCodeRepository,
    AuthSecondFactorService,
    AuthTokenIssuerService,
    MerchantActorRepository,
    CredentialsNotifierService,
  ],
})
export class AuthModule {}
