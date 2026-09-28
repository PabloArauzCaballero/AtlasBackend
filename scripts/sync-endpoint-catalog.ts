/**
 * Rellena el catálogo de ENDPOINTS (`platform_ops.system_endpoint_catalog`) desde el contrato
 * OpenAPI que este mismo backend genera de sus rutas. Sin HTTP, sin sesión y sin código fuente.
 *
 * Existe porque en un entorno desplegado nadie lo llenaba: el botón del portal pide el escaneo de
 * código fuente, que en la imagen (sólo `dist/`) responde 503, y el modo que sí funciona
 * (`POST /systems/endpoints/discover` con `OPENAPI_CONTRACT`) exige una persona con rol de gobierno
 * disparándolo a mano. Resultado medido en TEST el 2026-09-28: 0 endpoints, y detrás de él vacías
 * las pantallas de Sistemas → Endpoints, el selector del laboratorio de QA y los perfiles de estrés
 * (cada perfil apunta a un endpoint del catálogo, así que la siembra fundamental los omitía).
 *
 * Sólo AÑADE las operaciones que faltan (por método + ruta) y no toca las que ya están. A propósito:
 * `upsertEndpoint` —lo que usa el botón— devuelve la revisión a `AUTO_DETECTED`, y correr eso en
 * cada despliegue borraría el trabajo de quien revisó y aprobó endpoints desde el portal. Para
 * refrescar a propósito lo ya catalogado sigue estando el botón. Sólo escribe catálogo de
 * plataforma; no toca datos de negocio.
 *
 * Uso (desde JavaScript compilado, ver `scripts/check-nest-entrypoints.ts`):
 *   node dist/scripts/sync-endpoint-catalog.js
 */
import { NestFactory } from '@nestjs/core';

async function main(): Promise<void> {
  // La siembra de arranque es DESTRUCTIVA y no tiene nada que ver con esto. Se apaga antes de que
  // `src/config/env.js` se valide; por eso el resto de imports son dinámicos (ver el script de
  // introspección, que hace lo mismo por lo mismo).
  process.env.DATABASE_SEED_ON_STARTUP = 'false';
  const { AppModule } = await import('../src/app.module.js');
  const { env } = await import('../src/config/env.js');
  const { buildOpenApiDocument } = await import('../src/config/swagger.js');
  const { OpenApiCatalogService } = await import('../src/modules/systems-ops/openapi-catalog.service.js');
  const { SystemsCatalogRepository } = await import('../src/modules/systems-ops/systems-catalog.repository.js');

  // Una aplicación HTTP que NUNCA escucha: hace falta para que Swagger vea los controladores con
  // el mismo prefijo que `main.ts` —el catálogo guarda la ruta completa, `/api/v1/...`—, y sin
  // `init()` no arrancan los ganchos de ciclo de vida (programadores, colas, siembra).
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], abortOnError: false });
  try {
    app.setGlobalPrefix(env.API_PREFIX, { exclude: ['metrics'] });
    const document = buildOpenApiDocument(app);
    const repository = app.get(SystemsCatalogRepository);
    const seeds = app.get(OpenApiCatalogService).buildSeeds(document);
    let added = 0;
    // En serie: son ~570 consultas cortas una vez por despliegue, y el orden hace legible un fallo.
    for (const seed of seeds) {
      if (await repository.findEndpointByMethodAndPath(seed.method, seed.fullPath)) continue;
      await repository.upsertEndpoint(seed);
      added += 1;
    }
    console.log(
      `✅ Catálogo de endpoints: ${seeds.length} operaciones en el contrato, ${added} faltaban y se añadieron; las demás no se tocaron.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo rellenar el catálogo de endpoints desde el contrato OpenAPI.', error);
  process.exit(1);
});
