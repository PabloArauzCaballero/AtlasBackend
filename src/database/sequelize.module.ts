/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system conecta Sequelize con el registro de modelos y arranca el sembrado idempotente.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { buildSequelizeOptions } from '../config/database.config.js';
import { DbPoolMetricsService } from '../common/observability/db-pool-metrics.service.js';
import { StartupSeedService } from './startup-seed.service.js';
import { databaseModels } from './database-models.js';

export { databaseModels };

@Module({
  imports: [
    SequelizeModule.forRoot({
      ...buildSequelizeOptions(),
      models: databaseModels,
    }),
  ],
  // Seeding idempotente al arrancar (opt-in vía DATABASE_SEED_ON_STARTUP). No-op si la var está apagada.
  // `DbPoolMetricsService` se registra AQUÍ y no en `ObservabilityModule` a propósito: necesita la
  // conexión Sequelize, y este es el módulo que la provee. `MetricsService` llega por el módulo
  // global de observabilidad.
  providers: [StartupSeedService, DbPoolMetricsService],
})
export class DatabaseModule {}
