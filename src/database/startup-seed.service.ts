/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Client } from 'pg';
import { env } from '../config/env.js';
import { appRole, runsBackgroundWork } from '../config/app-role.js';
import { applyLocalIdentityOverrides } from './seed-local-identities.js';
import { resolveSeedSource } from './seed-source.js';
import { listSeededTables, syncSeedData } from './seed-sync.js';

/**
 * Trae las semillas al arrancar cuando la base está VACÍA (opt-in vía `DATABASE_SEED_ON_STARTUP`).
 *
 * La condición «vacía» no es un detalle: traer semillas es una carga DESTRUCTIVA —vacía las tablas
 * del manifiesto antes de escribirlas—, así que hacerlo en cada arranque borraría el trabajo de la
 * sesión anterior en una base de desarrollo. Cuando los seeders eran código versionado esto no se
 * planteaba, porque Umzug sólo corría lo no aplicado; ahora la salvaguarda tiene que ser explícita:
 * si alguna tabla del manifiesto ya tiene filas, este servicio no toca nada.
 *
 * Para RE-sembrar a propósito —descartando lo local— está `yarn db:seed:pull`, que es un acto
 * deliberado de una persona y no un efecto colateral de reiniciar un proceso.
 *
 * Un fallo NO tumba la API por defecto; con `DATABASE_SEED_ON_STARTUP_FAIL_FAST=true` aborta.
 */
@Injectable()
export class StartupSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupSeedService.name);

  async onApplicationBootstrap(): Promise<void> {
    if (!env.DATABASE_SEED_ON_STARTUP) return;

    // Sembrar es MUTAR: con N réplicas de API arrancando a la vez, N procesos harían la misma carga
    // destructiva en paralelo. Se restringe al proceso que ejecuta trabajo de fondo.
    if (!runsBackgroundWork()) {
      this.logger.log(`Siembra al arrancar omitida: este proceso tiene APP_ROLE=${appRole()} y sólo atiende HTTP.`);
      return;
    }

    const source = resolveSeedSource();
    if (!source) {
      this.logger.log('Siembra al arrancar omitida: no hay SEED_SOURCE_* configurado.');
      return;
    }

    try {
      await this.pullIfEmpty(source.connectionString, source.ssl, source.describe);
    } catch (error) {
      this.logger.error(
        'La siembra al arrancar falló. El backend continúa a menos que DATABASE_SEED_ON_STARTUP_FAIL_FAST=true.',
        error instanceof Error ? error.stack : String(error),
      );
      if (env.DATABASE_SEED_ON_STARTUP_FAIL_FAST) throw error;
    }
  }

  private async pullIfEmpty(connectionString: string, ssl: { rejectUnauthorized: boolean } | false, describe: string): Promise<void> {
    const source = new Client({ connectionString, ssl });
    const target = new Client({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_MIGRATION_USER ?? env.DB_USER,
      password: env.DB_MIGRATION_PASSWORD ?? env.DB_PASSWORD,
      ssl: env.DB_SSL ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } : false,
    });

    await source.connect();
    await target.connect();
    try {
      const alreadySeeded = await listSeededTables(target);
      if (alreadySeeded.length > 0) {
        this.logger.log(
          `Siembra al arrancar omitida: la base ya tiene datos (${alreadySeeded.length} tablas pobladas). ` +
            'Usa `yarn db:seed:pull` para reemplazarlos por lo publicado en la rama.',
        );
        return;
      }

      this.logger.log(`Base vacía: trayendo el conjunto sembrado desde ${describe}...`);
      const result = await syncSeedData({ source, target, log: (message) => this.logger.debug(message) });

      if (env.NODE_ENV !== 'production') {
        const overrides = await applyLocalIdentityOverrides(target, {
          adminEmail: env.DEV_ADMIN_EMAIL,
          adminPassword: env.DEV_ADMIN_PASSWORD,
          partnerPassword: env.DEV_PARTNER_PASSWORD,
        });
        if (overrides.applied.length > 0) {
          this.logger.log(`Credenciales locales reaplicadas: ${overrides.applied.join(', ')}.`);
        }
      }

      this.logger.log(`Siembra al arrancar completada: ${result.rows} filas en ${result.tables} tablas.`);
    } finally {
      await source.end();
      await target.end();
    }
  }
}
