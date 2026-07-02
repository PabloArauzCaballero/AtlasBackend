/**
 * ATLAS-AUDIT-006: genera `docs/endpoints/openapi.yaml` a partir del propio código (no a mano),
 * para que el contrato de API nunca se desincronice silenciosamente de los controladores reales.
 *
 * IMPORTANTE (transparencia de entrega): este script necesita levantar el `AppModule` completo,
 * lo que requiere una conexión real a PostgreSQL disponible (mismo requisito que `yarn start`).
 * No pudo ejecutarse en el sandbox donde se escribió este patch por no tener una base de datos
 * disponible. Ejecutar `yarn docs:openapi` con una base de datos local levantada (ver README)
 * para generar el archivo por primera vez.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import * as yaml from 'js-yaml';
import { AppModule } from '../src/app.module.js';
import { buildOpenApiDocument } from '../src/config/swagger.js';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
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
