import 'reflect-metadata';
// Fase 3.4: el bootstrap de OpenTelemetry debe importarse ANTES que cualquier módulo instrumentable
// (HTTP/Express/PG) para poder envolverlos. Es no-op salvo OTEL_ENABLED=true.
import './observability/tracing-bootstrap.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { env, getAllowedCorsOrigins } from './config/env.js';
import { buildOpenApiDocument } from './config/swagger.js';
import { setActiveEncryptionProvider } from './common/utils/crypto/envelope-encryption.util.js';
import { KmsKeyProvider } from './common/utils/crypto/kms-key-provider.js';
import { AppFileLogger } from './common/logging/app-file-logger.service.js';
import { shutdownTracing } from './observability/tracing.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('AtlasBootstrap');

  // Fase 3.3 del plan 10/10: si KMS está configurado (KMS_KEY_ID + AWS_REGION), se ACTIVA como
  // proveedor de cifrado de envelope encryption. A partir de ahí, todas las escrituras nuevas de
  // PII (customer-onboarding, notifications) se cifran con data keys de AWS KMS real, sin tocar
  // ningún call site: `encryptSecretEnvelope(x)` toma el proveedor activo. Los valores previos
  // cifrados con `local` se siguen descifrando (el proveedor `local` sigue registrado y el
  // providerId va embebido en cada valor). Sin KMS configurado, el proveedor activo permanece en
  // `local` — el default seguro para dev/test.
  if (env.KMS_KEY_ID && env.AWS_REGION) {
    setActiveEncryptionProvider(new KmsKeyProvider(env.KMS_KEY_ID, env.AWS_REGION));
    logger.log('KMS activado como proveedor de cifrado de PII (KMS_KEY_ID + AWS_REGION configurados).');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new AppFileLogger(),
    bufferLogs: env.NODE_ENV !== 'development',
    bodyParser: false,
  });

  // El contrato de ingesta de catalogos admite hasta 1.000 items por request y
  // recomienda cuerpos de 2 MB. El limite por defecto de Express (100 KB)
  // rechazaba lotes validos antes de alcanzar el ZodValidationPipe.
  app.useBodyParser('json', { limit: env.API_JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: env.API_JSON_BODY_LIMIT, extended: true });

  // Trust first proxy so req.ip resolves correctly behind a load balancer
  app.set('trust proxy', 1);

  // Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, CSP, etc.
  app.use(helmet());

  // `/metrics` se excluye del prefijo `/api/v1` para respetar la convención de scrape de Prometheus.
  app.setGlobalPrefix(env.API_PREFIX, { exclude: ['metrics'] });
  app.enableShutdownHooks();
  // Fase 3.4: flush de spans de OpenTelemetry al apagar (no-op si tracing está deshabilitado).
  process.once('SIGTERM', () => void shutdownTracing());
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
