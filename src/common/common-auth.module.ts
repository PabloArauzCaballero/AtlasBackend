/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza sostiene una parte mantenida del backend Atlas.
 * @system agrupa artefactos relacionados bajo un límite navegable.
 */
import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuthCredentialModel } from '../database/models/index.js';
import { RedisModule } from './redis/redis.module.js';
import { TokenRevocationService } from './services/token-revocation.service.js';

/**
 * Módulo global mínimo que expone `TokenRevocationService` a toda la aplicación (incluido
 * `JwtAuthGuard`, que se instancia por decorador en 15+ controladores sin importar módulos de
 * negocio explícitamente). Se mantiene separado de `AuthModule` a propósito: `AuthModule`
 * concentra los casos de uso de negocio (login/register/refresh), mientras que este módulo solo
 * expone la pieza de infraestructura compartida que un guard transversal necesita.
 *
 * Debe importarse una sola vez en `AppModule`.
 */
@Global()
@Module({
  imports: [SequelizeModule.forFeature([AuthCredentialModel]), RedisModule],
  providers: [TokenRevocationService],
  exports: [TokenRevocationService],
})
export class CommonAuthModule {}
