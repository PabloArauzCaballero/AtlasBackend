import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { env, getAllowedCorsOrigins } from './config/env.js';
import { buildOpenApiDocument } from './config/swagger.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('AtlasBootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Trust first proxy so req.ip resolves correctly behind a load balancer
  app.set('trust proxy', 1);

  // Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, CSP, etc.
  app.use(helmet());

  app.setGlobalPrefix(env.API_PREFIX);
  app.enableShutdownHooks();
  app.enableCors({
    origin: getAllowedCorsOrigins(),
    credentials: true,
  });

  if (env.API_DOCS_ENABLED) {
    const document = buildOpenApiDocument(app);
    SwaggerModule.setup(`${env.API_PREFIX}/docs`, app, document);
    logger.log(`Swagger UI disponible en /${env.API_PREFIX}/docs`);
  }

  await app.listen(env.APP_PORT);
  logger.log(`Atlas API escuchando en puerto ${env.APP_PORT} con prefijo /${env.API_PREFIX}`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('AtlasBootstrap');
  logger.error('No se pudo iniciar Atlas API.', error instanceof Error ? error.stack : undefined);
  process.exit(1);
});
