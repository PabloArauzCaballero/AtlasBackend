/**
 * Genera `docs/endpoints/openapi.yaml` a partir del código.
 *
 * Usa el modo preview de Nest: descubre módulos y controladores sin instanciar providers ni abrir
 * conexiones a PostgreSQL, Redis o proveedores externos.
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
  // Swagger solo necesita los metadatos de módulos, controladores y decoradores. El modo preview
  // evita que una exportación documental quede bloqueada por infraestructura ajena al contrato.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
    preview: true,
  });
  const document = buildOpenApiDocument(app);

  const outputPath = join(process.cwd(), 'docs', 'endpoints', 'openapi.yaml');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, yaml.dump(document, { noRefs: true }), 'utf8');

  console.log(`✅ OpenAPI exportado a ${outputPath}`);
  await app.close();
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo generar el OpenAPI desde los metadatos de Nest.', error);
  process.exit(1);
});
