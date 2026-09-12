/**
 * Rellena el catálogo de COLUMNAS y de RELACIONES tabla→tabla desde `information_schema`.
 *
 * Existe porque el grafo de linaje del portal interno dibuja las conexiones entre tablas leyendo
 * `system_data_relationship_catalog`, y esa tabla solo la escribe
 * `SystemsSchemaIntrospectionService.seedColumnsFromInformationSchema()`. Hasta ahora la única
 * forma de dispararlo era `POST /systems/endpoints/catalog-seed/refresh`, que además siembra
 * herramientas y endpoints y exige un actor con rol de gobierno; en una base recién promovida eso
 * dejaba el catálogo de relaciones vacío y la pantalla mostrando nodos sueltos sin una sola arista
 * entre tablas —no por un fallo de dibujo, sino porque no había nada que dibujar.
 *
 * Es idempotente: cada relación se busca por (esquema, tabla, columna) en los dos extremos y se
 * actualiza en vez de duplicarse. Solo lee `information_schema` y escribe catálogo de plataforma;
 * no toca datos de negocio.
 *
 * Uso (desde JavaScript compilado, ver `scripts/check-nest-entrypoints.ts`):
 *   node dist/scripts/refresh-systems-catalog-introspection.js
 */
import { NestFactory } from '@nestjs/core';

async function main(): Promise<void> {
  /*
   * La siembra de arranque es una carga DESTRUCTIVA (vacía las tablas del manifiesto) y no tiene
   * nada que ver con introspeccionar el esquema. Se apaga ANTES de que `src/config/env.js` se
   * valide, y por eso el resto de imports son dinámicos: un `import` estático se iza por encima de
   * esta línea y la dejaría sin efecto.
   */
  process.env.DATABASE_SEED_ON_STARTUP = 'false';
  const { AppModule } = await import('../src/app.module.js');
  const { SystemsCatalogSeedService } = await import('../src/modules/systems-ops/systems-catalog-seed.service.js');

  const context = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'], abortOnError: false });
  try {
    const result = await context.get(SystemsCatalogSeedService).seedColumnsFromInformationSchema();
    console.log(`✅ Catálogo de esquema refrescado: ${result.columns} columnas y ${result.relationships} relaciones FK.`);
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo refrescar el catálogo desde information_schema.', error);
  process.exit(1);
});
