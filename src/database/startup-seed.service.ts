/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { env } from '../config/env.js';
import { appRole, runsBackgroundWork } from '../config/app-role.js';
import { seedOnStartup } from './seed-runner.js';

/**
 * Seeding idempotente automático al arrancar (opt-in vía `DATABASE_SEED_ON_STARTUP`).
 *
 * Corre en `onApplicationBootstrap` (después de que todos los módulos se inicializan). Aplica los
 * seeders PENDIENTES del perfil derivado de SEED_PROFILE/NODE_ENV de forma idempotente (Umzug solo
 * ejecuta los no aplicados; los seeders son upsert-safe). NUNCA corre seeders de dev/demo en
 * producción — el perfil `production` solo incluye el stage `production`.
 *
 * Un fallo de seed NO tumba la API por defecto (se loguea y el backend arranca igual); con
 * `DATABASE_SEED_ON_STARTUP_FAIL_FAST=true` el arranque aborta.
 */
@Injectable()
export class StartupSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupSeedService.name);

  async onApplicationBootstrap(): Promise<void> {
    if (!env.DATABASE_SEED_ON_STARTUP) return;

    // Sembrar es MUTAR: con N réplicas de API arrancando a la vez, N procesos aplicarían los mismos
    // seeders en paralelo. Se restringe al proceso que ejecuta trabajo de fondo (worker, o `all` en
    // un despliegue de una sola pieza). El camino recomendado en producción sigue siendo el job
    // one-shot `migrate` del compose, que corre antes que la API y el worker.
    if (!runsBackgroundWork()) {
      this.logger.log(`Seeding al arrancar omitido: este proceso tiene APP_ROLE=${appRole()} y sólo atiende HTTP.`);
      return;
    }

    this.logger.log('DATABASE_SEED_ON_STARTUP=true: aplicando seeders pendientes al arrancar (idempotente)...');
    try {
      const result = await seedOnStartup();
      if (result.totalApplied === 0) {
        this.logger.log(`Seeding al arrancar: base ya al día (perfil "${result.profile}", 0 seeders nuevos).`);
      } else {
        this.logger.log(
          `Seeding al arrancar: perfil "${result.profile}", ${result.totalApplied} seeder(s) aplicado(s). ` +
            JSON.stringify(result.appliedByStage),
        );
      }
    } catch (error) {
      this.logger.error(
        'Seeding al arrancar falló. El backend continúa a menos que DATABASE_SEED_ON_STARTUP_FAIL_FAST=true.',
        error instanceof Error ? error.stack : String(error),
      );
      if (env.DATABASE_SEED_ON_STARTUP_FAIL_FAST) {
        throw error; // aborta el arranque (bootstrap() rechaza → main.ts sale con exit≠0).
      }
    }
  }
}
