/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza implementa las capacidades operativas, de identidad, riesgo y crédito de Atlas.
 * @system organiza el runtime NestJS en módulos con límites explícitos y dependencias dirigidas.
 */
import 'reflect-metadata';
// Fase 3.4: el bootstrap de OpenTelemetry debe importarse ANTES que cualquier módulo instrumentable
// (HTTP/Express/PG) para poder envolverlos. Es no-op salvo OTEL_ENABLED=true.
import './observability/tracing-bootstrap.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module.js';
import { env, getAllowedCorsOrigins } from './config/env.js';
import { appRole, runsHttpApi } from './config/app-role.js';
import { setupApiDocumentation } from './config/openapi/api-reference.setup.js';
import { setActiveEncryptionProvider } from './common/utils/crypto/envelope-encryption.util.js';
import { KmsKeyProvider } from './common/utils/crypto/kms-key-provider.js';
import { AppFileLogger } from './common/logging/app-file-logger.service.js';
import { shutdownTracing } from './observability/tracing.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('AtlasBootstrap');

  // Simétrico al guard de `worker.ts`. Arrancar la API completa con `APP_ROLE=worker` expondría los
  // controllers de negocio en un contenedor que el manifiesto trata como interno, así que se falla
  // en vez de montarlos: un rol mal puesto tiene que doler al desplegar, no en la primera auditoría.
  if (!runsHttpApi()) {
    logger.error(`APP_ROLE=${appRole()}: este entrypoint es el de la API. Arranca el worker con \`node dist/src/worker.js\`.`);
    process.exit(1);
  }

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

  // Compresión gzip de respuestas. Los listados paginados (hasta limit=100 con payloads JSON por
  // fila) viajan sin comprimir si el proceso Node sirve directo. `compression` respeta Accept-Encoding
  // y solo comprime por encima de su umbral (1KB por defecto). Si un reverse proxy ya comprime, esto
  // es redundante pero inofensivo (el proxy suele terminar TLS y recomprimir).
  app.use(compression());

  // `/metrics` se excluye del prefijo `/api/v1` para respetar la convención de scrape de Prometheus.
  app.setGlobalPrefix(env.API_PREFIX, { exclude: ['metrics'] });
  app.enableShutdownHooks();
  // Fase 3.4: flush de spans de OpenTelemetry al apagar (no-op si tracing está deshabilitado).
  // SIGINT además de SIGTERM para cubrir Ctrl-C en dev y orquestadores que envían SIGINT.
  process.once('SIGTERM', () => void shutdownTracing());
  process.once('SIGINT', () => void shutdownTracing());
  app.enableCors({
    origin: getAllowedCorsOrigins(),
    credentials: true,
  });

  // Referencia interactiva (Scalar) + Swagger UI + contrato crudo. Ver src/config/openapi/.
  setupApiDocumentation(app);

  await app.listen(env.APP_PORT);
  logger.log(`Atlas API escuchando en puerto ${env.APP_PORT} con prefijo /${env.API_PREFIX}`);
}

// Última red de seguridad para fallos asíncronos que escapan a todo try/catch. Sin estos handlers,
// Node imprime el stack a stderr FUERA de AppFileLogger (no llega a Archivo.log ni al sync a Mongo):
// el crash quedaría sin evidencia en el pipeline de logs propio. Se loguea con stack, se intenta un
// flush de trazas y se sale con código ≠ 0 para que el orquestador reinicie el proceso.
function installGlobalCrashHandlers(): void {
  const logger = new Logger('AtlasProcess');
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

bootstrap().catch((error: unknown) => {
  const logger = new Logger('AtlasBootstrap');
  logger.error('No se pudo iniciar Atlas API.', error instanceof Error ? error.stack : undefined);
  process.exit(1);
});
