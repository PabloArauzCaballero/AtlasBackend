/**
 * Genera `docs/endpoints/openapi.yaml` a partir del código.
 *
 * Requiere levantar `AppModule`, por lo que necesita una conexión PostgreSQL disponible.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import * as yaml from 'js-yaml';
import { AppModule } from '../src/app.module.js';
import { buildOpenApiDocument } from '../src/config/swagger.js';

async function main(): Promise<void> {
  // Este script debe ejecutarse desde JavaScript compilado: tsx/esbuild no emite
  // `design:paramtypes`, metadata que Nest necesita para resolver providers del AppModule.
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const document = buildOpenApiDocument(app);

  const outputPath = join(process.cwd(), 'docs', 'endpoints', 'openapi.yaml');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, yaml.dump(document, { noRefs: true }), 'utf8');

  console.log(`✅ OpenAPI exportado a ${outputPath}`);
  await app.close();
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo generar el OpenAPI. ¿Hay una base de datos PostgreSQL disponible?', error);
  process.exit(1);
});
