/**
 * @file Entrypoint del worker de Mensajería del piloto (AT-057).
 * @business Arranca SOLO Mensajería con su identidad de base; expone la misma sonda que el worker
 *   (readiness honesta: si su base no responde, no arranca) y se apaga con drenado.
 * @system `MessagingWorkerModule` + sonda del worker en `WORKER_PROBE_PORT`. Exige `APP_ROLE=worker`.
 *   Mientras `context_ownership` nombre al monolito, el proceso late cercado (no reclama nada).
 */
import 'reflect-metadata';
import './observability/tracing-bootstrap.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type Redis from 'ioredis';
import { MessagingWorkerModule } from './bootstrap/messaging-worker.module.js';
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

async function bootstrapMessagingWorker(): Promise<void> {
  assertDecoratorMetadataIsAvailable();
  const logger = new Logger('AtlasMessagingWorker');
  if (appRole() !== 'worker') {
    logger.error('El worker de Mensajería exige APP_ROLE=worker: no sirve HTTP de negocio ni comparte proceso con la API.');
    process.exit(1);
  }
  if (env.KMS_KEY_ID && env.AWS_REGION) setActiveEncryptionProvider(new KmsKeyProvider(env.KMS_KEY_ID, env.AWS_REGION));

  const context = await NestFactory.createApplicationContext(MessagingWorkerModule, {
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
  logger.log(`Atlas messaging-worker activo (versión=${buildInfo.version}). Sonda en el puerto ${env.WORKER_PROBE_PORT}.`);

  const close = async (signal: string): Promise<void> => {
    logger.log(`Señal ${signal}: cerrando el worker de Mensajería.`);
    await context.close();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await shutdownTracing();
    process.exit(0);
  };
  process.once('SIGTERM', () => void close('SIGTERM'));
  process.once('SIGINT', () => void close('SIGINT'));
}

process.on('unhandledRejection', (reason: unknown) => {
  new Logger('AtlasMessagingWorkerProcess').error('unhandledRejection', reason instanceof Error ? reason.stack : String(reason));
  void shutdownTracing().finally(() => process.exit(1));
});

bootstrapMessagingWorker().catch((error: unknown) => {
  new Logger('AtlasMessagingWorker').error(
    'No se pudo arrancar el worker de Mensajería.',
    error instanceof Error ? error.stack : String(error),
  );
  void shutdownTracing().finally(() => process.exit(1));
});
