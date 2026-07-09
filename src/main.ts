import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { env, getAllowedCorsOrigins } from './config/env.js';
import { buildOpenApiDocument } from './config/swagger.js';
import { registerDataKeyProvider } from './common/utils/crypto/envelope-encryption.util.js';
import { KmsKeyProvider } from './common/utils/crypto/kms-key-provider.js';
import { AppFileLogger } from './common/logging/app-file-logger.service.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('AtlasBootstrap');

  // ATLAS-P11-T13: registro opcional del proveedor KMS real para envelope encryption. No activa
  // el cifrado de PII con KMS por sí solo (ver la nota de alcance en
  // envelope-encryption.util.ts) — solo lo deja disponible como `providersById['kms']` para el
  // día en que se decida migrar los call sites reales a una firma async con KMS de verdad.
  if (env.KMS_KEY_ID && env.AWS_REGION) {
    registerDataKeyProvider(new KmsKeyProvider(env.KMS_KEY_ID, env.AWS_REGION));
    logger.log('Proveedor KmsKeyProvider registrado para envelope-encryption.util.ts (KMS_KEY_ID configurado).');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new AppFileLogger(),
    bufferLogs: env.NODE_ENV !== 'development',
  });

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
