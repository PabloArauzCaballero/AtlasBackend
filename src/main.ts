import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { env, getAllowedCorsOrigins } from './config/env.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('AtlasBootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.setGlobalPrefix(env.API_PREFIX);
  app.enableShutdownHooks();
  app.enableCors({
    origin: getAllowedCorsOrigins(),
    credentials: true,
  });

  await app.listen(env.APP_PORT);
  logger.log(`Atlas API escuchando en puerto ${env.APP_PORT} con prefijo /${env.API_PREFIX}`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('AtlasBootstrap');
  logger.error('No se pudo iniciar Atlas API.', error instanceof Error ? error.stack : undefined);
  process.exit(1);
});
