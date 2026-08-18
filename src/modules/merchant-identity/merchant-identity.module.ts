/**
 * @file Módulo Nest: compone providers, controladores y dependencias del dominio.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada alta.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MerchantUserModel } from '../../database/models/index.js';
import { AuthModule } from '../auth/auth.module.js';
import { InternalUsersModule } from '../internal-users/internal-users.module.js';
import { MerchantAuthController } from './merchant-auth.controller.js';
import { MerchantAuthService } from './merchant-auth.service.js';
import { MerchantUsersController } from './merchant-users.controller.js';
import { MerchantUsersService } from './merchant-users.service.js';

/**
 * Identidad del comercio afiliado: la cuarta población autenticable de Atlas.
 *
 * Depende de `AuthModule` (credenciales, tokens, revocación) y de `InternalUsersModule` (el guard
 * de permisos internos que protege el alta). No depende del ERP ni sabe qué comercio opera cada
 * persona: esa relación es del ERP y no se duplica aquí.
 */
@Module({
  imports: [SequelizeModule.forFeature([MerchantUserModel]), AuthModule, InternalUsersModule],
  controllers: [MerchantAuthController, MerchantUsersController],
  providers: [MerchantAuthService, MerchantUsersService],
  exports: [MerchantUsersService],
})
export class MerchantIdentityModule {}
