/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system arranca el proceso worker: mismos módulos que la API, sin rutas de negocio.
 */
import 'reflect-metadata';
// Igual que en `main.ts`: el bootstrap de OpenTelemetry debe importarse ANTES que cualquier módulo
// instrumentable. Es no-op salvo OTEL_ENABLED=true.
import './observability/tracing-bootstrap.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type Redis from 'ioredis';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';
import { appRole } from './config/app-role.js';
import { buildInfo } from './config/build-info.js';
import { setActiveEncryptionProvider } from './common/utils/crypto/envelope-encryption.util.js';
import { KmsKeyProvider } from './common/utils/crypto/kms-key-provider.js';
import { assertDecoratorMetadataIsAvailable } from './common/bootstrap/decorator-metadata.guard.js';
import { AppFileLogger } from './common/logging/app-file-logger.service.js';
import { REDIS_CLIENT } from './common/redis/redis.module.js';
import { MetricsService } from './common/observability/metrics.service.js';
import { GracefulShutdownService } from './common/lifecycle/graceful-shutdown.service.js';
import { shutdownTracing } from './observability/tracing.js';
import { createWorkerProbeServer } from './worker/worker-probe-server.js';

/**
 * Proceso WORKER de Atlas.
 *
 * Misma imagen y mismo `AppModule` que la API — cambia el entrypoint, no el código de dominio. Lo
 * que hace distinto:
 *
 * 1. Usa `createApplicationContext()`, que instancia todos los providers pero **no registra ninguna
 *    ruta**. Los controllers de negocio simplemente no existen en este proceso.
 * 2. Levanta una sonda HTTP mínima (`/health/liveness`, `/health/readiness`, `/metrics`) para que el
 *    orquestador pueda decidir si el contenedor está sano y Prometheus pueda hacer scrape.
 * 3. Los servicios de fondo (`RuntimeJobsSchedulerService`, `SystemsHealthMonitorService`,
 *    `StartupSeedService`) arrancan solos porque `runsBackgroundWork()` es verdadero con
 *    `APP_ROLE=worker`. No hay ningún registro de jobs duplicado aquí: la lista vive donde siempre.
 *
 * Ver `docs/architecture/background-processing.md`.
 */
async function bootstrapWorker(): Promise<void> {
  // Mismo guard que la API: sin metadata de decoradores, el contenedor falla culpando a un
  // módulo sano en vez de al runtime. Ver `decorator-metadata.guard.ts`.
  assertDecoratorMetadataIsAvailable();

  const logger = new Logger('AtlasWorker');

  if (appRole() === 'api') {
    logger.error('APP_ROLE=api: este entrypoint es el del worker. Arranca la API con `node dist/src/main.js`.');
    process.exit(1);
  }

  // Mismo cableado de KMS que la API: el worker también escribe PII (entrega de notificaciones,
  // retención), así que necesita el mismo proveedor de cifrado activo o los valores nuevos saldrían
  // cifrados con `local` mientras los de la API salen con KMS.
  if (env.KMS_KEY_ID && env.AWS_REGION) {
    setActiveEncryptionProvider(new KmsKeyProvider(env.KMS_KEY_ID, env.AWS_REGION));
    logger.log('KMS activado como proveedor de cifrado de PII.');
  }

  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: new AppFileLogger(),
    bufferLogs: env.NODE_ENV !== 'development',
  });
  context.enableShutdownHooks();

  const probe = createWorkerProbeServer({
    sequelize: context.get<Sequelize>(getConnectionToken()),
    redis: context.get<Redis | null>(REDIS_CLIENT, { strict: false }),
    metrics: context.get(MetricsService, { strict: false }),
    shutdown: context.get(GracefulShutdownService),
  });

  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(env.WORKER_PROBE_PORT, resolve);
  });

  logger.log(`Atlas worker activo (rol=${appRole()}, versión=${buildInfo.version}). Sonda en el puerto ${env.WORKER_PROBE_PORT}.`);

  // El cierre de la sonda va ANTES de cerrar el contexto: readiness debe dejar de responder 200
  // mientras los módulos siguen vivos, no después. `GracefulShutdownService` ya introduce el drenado
  // en `beforeApplicationShutdown`, así que basta con cerrar el socket al final.
  const close = async (signal: string): Promise<void> => {
    logger.log(`Señal ${signal}: cerrando el worker.`);
    await context.close();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await shutdownTracing();
    process.exit(0);
  };
  process.once('SIGTERM', () => void close('SIGTERM'));
  process.once('SIGINT', () => void close('SIGINT'));
}

// Misma red de seguridad que `main.ts`: sin estos handlers, un rechazo asíncrono de un job imprime
// su stack a stderr fuera de `AppFileLogger` y el crash queda sin evidencia en el pipeline de logs.
function installGlobalCrashHandlers(): void {
  const logger = new Logger('AtlasWorkerProcess');
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandledRejection: promesa rechazada sin catch.', reason instanceof Error ? reason.stack : String(reason));
    void shutdownTracing().finally(() => process.exit(1));
  });
  process.on('uncaughtException', (error: Error) => {
    logger.error('uncaughtException: excepción no capturada.', error.stack);
    void shutdownTracing().finally(() => process.exit(1));
  });
}

installGlobalCrashHandlers();

bootstrapWorker().catch((error: unknown) => {
  const logger = new Logger('AtlasWorker');
  logger.error('No se pudo iniciar el worker de Atlas.', error instanceof Error ? error.stack : undefined);
  process.exit(1);
});
