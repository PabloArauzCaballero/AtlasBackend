/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza deja que una persona se verifique desde su teléfono con su carnet, sin pasar por una sucursal.
 * @system declara el límite de inyección del flujo móvil de verificación de identidad.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { IdentityVerificationAttemptModel } from '../../database/models/index.js';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module.js';
import { CustomerOnboardingModule } from '../customer-onboarding/customer-onboarding.module.js';
import { MobileIdentityController } from './mobile-identity.controller.js';
import { MobileIdentityRepository } from './mobile-identity.repository.js';
import { MobileIdentityService } from './mobile-identity.service.js';

/**
 * Módulo propio y no una carpeta dentro de `customer-onboarding`.
 *
 * Son dos cosas con ciclos de vida distintos: el alta de un cliente es un flujo
 * largo con contactos, dirección y consentimientos, mientras que esto es un
 * trámite corto que puede ocurrir ANTES de que ese cliente exista —de hecho es
 * lo normal en el móvil: primero se demuestra quién eres, después se crea la
 * ficha—. Meterlo dentro habría acoplado la verificación al orden del otro flujo
 * y, de paso, engordado un módulo que ya está en el techo del gate de tamaño.
 */
@Module({
  /*
   * `CustomerOnboardingModule` entra por UNA cosa: los agregados de la agenda,
   * que son una de las tres entradas del artefacto de identidad. No se copia la
   * lectura aquí porque entonces habría dos definiciones de qué significa «la
   * agenda de este cliente», y basta con que se separen una vez para que la
   * política decida sobre números que nadie escribió.
   */
  imports: [
    SequelizeModule.forFeature([IdentityVerificationAttemptModel]),
    DecisionEngineModule,
    CustomerOnboardingModule,
  ],
  controllers: [MobileIdentityController],
  providers: [MobileIdentityRepository, MobileIdentityService],
  exports: [MobileIdentityService],
})
export class MobileIdentityModule {}
