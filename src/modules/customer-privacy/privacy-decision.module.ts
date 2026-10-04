/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business El Motor opina sobre las solicitudes del titular sin que el worker cargue con la superficie HTTP de privacidad.
 * @system aporta `PrivacyRequestDecisionService` (opinión en sombra) al planificador de trabajos de fondo.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DataSubjectRequestModel } from '../../database/models/index.js';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module.js';
import { PrivacyRequestDecisionService } from './application/privacy-request-decision.service.js';
import { PrivacyRequestFactsRepository } from './application/privacy-request-facts.repository.js';

/**
 * Aparte de `CustomerPrivacyModule` a propósito: aquél trae los controladores del cliente y de la cola interna, los
 * consentimientos y los permisos internos, y el worker no atiende HTTP (`WORKER_EXCLUDED_MODULES`). Esto es lo único
 * que el trabajo de fondo necesita: leer los hechos de la cuenta, preguntar al Motor y guardar su opinión.
 */
@Module({
  imports: [SequelizeModule.forFeature([DataSubjectRequestModel]), DecisionEngineModule],
  providers: [PrivacyRequestFactsRepository, PrivacyRequestDecisionService],
  exports: [PrivacyRequestDecisionService],
})
export class PrivacyDecisionModule {}
