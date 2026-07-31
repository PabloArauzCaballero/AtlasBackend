/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza permite retirar instancias enfermas antes de afectar a clientes u operadores.
 * @system expone liveness y readiness con estados HTTP útiles para orquestadores.
 */
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
