/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import argon2 from 'argon2';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import { Sequelize } from 'sequelize-typescript';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { SystemsHealthStatus } from './systems-ops.dtos.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { mapTool } from './systems-ops.mapper.js';
import { probePlatformService } from './platform-service-health.probe.js';

type LiveHealthResult = Pick<SystemsHealthStatus, 'checkType' | 'isHealthy' | 'healthMessage'>;

/** Tablas de infraestructura probadas con un `SELECT 1 ... LIMIT 1` por código de herramienta. */
const TABLE_PROBES: Readonly<Record<string, string>> = {
  OUTBOX_EVENTS_DB: 'outbox_events',
  IDEMPOTENCY_KEYS_DB: 'idempotency_keys',
  OPERATIONAL_AUDIT_LOGS: 'operational_audit_logs',
  SYSTEM_ACTION_LOGS: 'system_action_logs',
};

/**
 * Herramientas donde monitorear en runtime NO aplica (no es que "falte" un probe): tooling de
 * desarrollo que nunca corre dentro del backend. El mensaje dice honestamente por qué.
 */
const NOT_APPLICABLE_TOOLS: Readonly<Record<string, string>> = {
  JEST: 'Herramienta de desarrollo: las pruebas corren en CI o en local, nunca dentro del backend. No hay nada que monitorear en runtime.',
  SMOKE_SCRIPTS:
    'Scripts de smoke: se ejecutan a demanda desde scripts/smoke, nunca dentro del backend. No hay nada que monitorear en runtime.',
};

@Injectable()
export class SystemsHealthService implements OnModuleDestroy {
  private mongoClient: MongoClient | null = null;

  constructor(
    private readonly repository: SystemsCatalogRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.mongoClient?.close().catch(() => undefined);
    this.mongoClient = null;
  }

  async getToolsHealth(): Promise<SystemsHealthStatus[]> {
    const result = await this.repository.listTools({
      page: 1,
      limit: 100,
      status: undefined,
      module: undefined,
      riskLevel: undefined,
      reviewStatus: undefined,
      q: undefined,
    });
    return Promise.all(
      result.rows.map(async (tool) => {
        const dto = mapTool(tool);
        const parsedEnv = env as unknown as Record<string, unknown>;
        const missingEnvVars = dto.requiredEnvVars.filter((envVar) => {
          const value = parsedEnv[envVar] ?? process.env[envVar];
          return value === undefined || value === null || value === '';
        });
        let live = await this.liveHealth(dto.code, missingEnvVars.length === 0);
        // Una herramienta PLANNED no está "caída" ni "sin probe": todavía no existe contrato ni
        // integración implementada, así que no hay nada que probar. Se reporta NOT_APPLICABLE con
        // el motivo real; el rojo queda reservado a herramientas activas con problemas de verdad.
        if (live.checkType === 'CONFIGURATION' && dto.status === 'PLANNED') {
          live = {
            checkType: 'NOT_APPLICABLE',
            isHealthy: null,
            healthMessage:
              'Herramienta planificada: aún no hay contrato ni integración implementada, así que no existe nada que probar en runtime.',
          };
        }
        return {
          code: dto.code,
          name: dto.name,
          status: dto.status,
          isConfigured: missingEnvVars.length === 0,
          missingEnvVars,
          isCritical: dto.isCritical,
          isWorker: dto.isWorker,
          ...live,
        };
      }),
    );
  }

  private async liveHealth(code: string, configured: boolean): Promise<LiveHealthResult> {
    try {
      if (code === 'POSTGRES') {
        await this.sequelize.authenticate();
        return { checkType: 'LIVE', isHealthy: true, healthMessage: 'PostgreSQL respondió correctamente.' };
      }
      if (code === 'REDIS' || code === 'NEST_THROTTLER_REDIS') {
        if (!this.redis) return { checkType: 'LIVE', isHealthy: false, healthMessage: 'Cliente Redis no configurado.' };
        await this.redis.ping();
        return { checkType: 'LIVE', isHealthy: true, healthMessage: 'Redis respondió PONG.' };
      }
      const localProbe = await this.localRuntimeProbe(code);
      if (localProbe) return localProbe;
      // Servicios hermanos del ecosistema: se comprueban por HTTP contra su healthcheck, no por
      // conexión de base ni por tabla, porque viven fuera de este proceso.
      const platformProbe = await probePlatformService(code);
      if (platformProbe) return platformProbe;
      const table = TABLE_PROBES[code];
      if (table) {
        const schema = atlasSchemaFor(table);
        await this.sequelize.query(`SELECT 1 FROM "${schema}"."${table}" LIMIT 1`);
        return { checkType: 'LIVE', isHealthy: true, healthMessage: `Tabla ${schema}.${table} accesible.` };
      }
      if (code === 'ARCHIVO_LOG_MONGO_SYNC') {
        return await this.mongoPing(configured);
      }
      return {
        checkType: 'CONFIGURATION',
        isHealthy: configured ? null : false,
        healthMessage: configured
          ? 'Variables requeridas presentes; esta herramienta aún no expone un chequeo en vivo.'
          : 'Faltan variables requeridas para una herramienta activa; revisa el .env del backend.',
      };
    } catch (error) {
      return { checkType: 'LIVE', isHealthy: false, healthMessage: error instanceof Error ? error.message : 'Healthcheck falló.' };
    }
  }

  /** Probes de librerías/runtime locales y clasificación estática honesta; null si el código no es de este grupo. */
  private async localRuntimeProbe(code: string): Promise<LiveHealthResult | null> {
    const notApplicable = NOT_APPLICABLE_TOOLS[code];
    if (notApplicable) {
      return { checkType: 'NOT_APPLICABLE', isHealthy: null, healthMessage: notApplicable };
    }
    if (code === 'OPENAPI_SWAGGER') {
      // El documento OpenAPI se genera en el bootstrap y se sirve desde este mismo proceso:
      // si esta respuesta llegó al cliente, la documentación está disponible.
      return { checkType: 'LIVE', isHealthy: true, healthMessage: 'Swagger/OpenAPI se sirve con este mismo backend y está disponible.' };
    }
    if (code === 'SEQUELIZE') {
      await this.sequelize.authenticate();
      const modelCount = Object.keys(this.sequelize.models).length;
      return { checkType: 'LIVE', isHealthy: true, healthMessage: `Sequelize operativo con ${modelCount} modelos registrados.` };
    }
    if (code === 'JWT') {
      const token = jwt.sign({ probe: true }, env.JWT_ACCESS_TOKEN_SECRET, { expiresIn: 60 });
      jwt.verify(token, env.JWT_ACCESS_TOKEN_SECRET);
      return { checkType: 'LIVE', isHealthy: true, healthMessage: 'Firma y verificación JWT operativas con el secreto configurado.' };
    }
    if (code === 'ARGON2') {
      // Parámetros bajos a propósito: es un probe periódico, no un hash de contraseña real.
      const hash = await argon2.hash('atlas-healthcheck', { timeCost: 2, memoryCost: 8192, parallelism: 1 });
      if (!(await argon2.verify(hash, 'atlas-healthcheck'))) {
        throw new Error('argon2.verify devolvió false para un hash recién generado.');
      }
      return { checkType: 'LIVE', isHealthy: true, healthMessage: 'Hash y verificación Argon2 operativos.' };
    }
    if (code === 'ZOD') {
      z.object({ ok: z.literal(true) }).parse({ ok: true });
      return { checkType: 'LIVE', isHealthy: true, healthMessage: 'Validación Zod operativa.' };
    }
    return null;
  }

  /**
   * Ping a MongoDB con un cliente propio perezoso (mismo patrón que `MongoLogsQueryService`):
   * se conecta una vez y se reutiliza entre chequeos; si el ping falla se descarta el cliente
   * para forzar una reconexión limpia en el siguiente ciclo.
   */
  private async mongoPing(configured: boolean): Promise<LiveHealthResult> {
    if (!env.MONGO_DB_URL_CONNECTION) {
      return {
        checkType: 'CONFIGURATION',
        isHealthy: configured ? null : false,
        healthMessage: 'MONGO_DB_URL_CONNECTION no configurada; sin probe activo.',
      };
    }
    try {
      if (!this.mongoClient) {
        const client = new MongoClient(env.MONGO_DB_URL_CONNECTION, {
          serverSelectionTimeoutMS: env.LOG_SYNC_MONGO_SERVER_SELECTION_TIMEOUT_MS,
        });
        try {
          await client.connect();
        } catch (error) {
          await client.close().catch(() => undefined);
          throw error;
        }
        this.mongoClient = client;
      }
      await this.mongoClient.db('admin').command({ ping: 1 });
      return { checkType: 'LIVE', isHealthy: true, healthMessage: 'MongoDB respondió al ping.' };
    } catch (error) {
      await this.mongoClient?.close().catch(() => undefined);
      this.mongoClient = null;
      return { checkType: 'LIVE', isHealthy: false, healthMessage: error instanceof Error ? error.message : 'Ping a MongoDB falló.' };
    }
  }
}
