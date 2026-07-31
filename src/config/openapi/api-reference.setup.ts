/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite que un integrador descubra y pruebe la API sin leer el código fuente.
 * @system monta la referencia interactiva y el documento OpenAPI servido por la propia API.
 */
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { env } from '../env.js';
import { buildInfo } from '../build-info.js';
import { buildOpenApiDocument } from '../swagger.js';

/**
 * Monta la documentación de la API.
 *
 * Tres rutas, cada una con un consumidor distinto:
 *
 *   `/{prefix}/reference`      → Scalar. Es la referencia que se le pasa a un integrador.
 *   `/{prefix}/docs`           → Swagger UI. Se conserva porque hay clientes y scripts que ya la usan.
 *   `/{prefix}/docs/openapi.json` → el documento crudo, para generadores de cliente y para Scalar.
 *
 * Todo esto vive detrás de `API_DOCS_ENABLED`. En producción el default es apagado: el contrato
 * describe endpoints internos, roles y la forma de los datos, que es exactamente el mapa que un
 * atacante querría. Publicarlo es una decisión, no un descuido.
 *
 * `NO` se sirve el YAML del repositorio: se sirve el documento que ESTE proceso genera de sus propias
 * rutas. Un archivo versionado puede estar desactualizado; lo que el proceso tiene montado, no.
 */
export function setupApiDocumentation(app: NestExpressApplication): void {
  const logger = new Logger('AtlasApiDocs');

  if (!env.API_DOCS_ENABLED) {
    logger.log('Documentación de API deshabilitada (API_DOCS_ENABLED=false).');
    return;
  }

  const document = buildOpenApiDocument(app);
  const prefix = env.API_PREFIX.replace(/^\/+|\/+$/g, '');

  // Swagger UI, que ya estaba montada. Se conserva para no romper a quien la tenga en marcadores o
  // en un script; Scalar es la referencia recomendada, no un reemplazo forzado.
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  // El documento crudo. Es lo que consumen los generadores de cliente. Se monta como middleware y no
  // por el adaptador HTTP para no depender de los tipos de Express/Fastify del adaptador concreto.
  app.use(`/${prefix}/docs/openapi.json`, (_request: unknown, response: unknown) => {
    const httpResponse = response as { setHeader: (name: string, value: string) => void; end: (body: string) => void };
    httpResponse.setHeader('Content-Type', 'application/json; charset=utf-8');
    httpResponse.end(JSON.stringify(document));
  });

  app.use(
    `/${prefix}/reference`,
    apiReference({
      content: document,
      // El orden de las etiquetas lo fija el contrato (recorrido de negocio, no alfabético); ordenar
      // aquí otra vez lo contradiría.
      pageTitle: `Atlas API · ${buildInfo.version}${env.NODE_ENV === 'production' ? '' : ` · ${env.NODE_ENV.toUpperCase()}`}`,
      // Fuera de producción se avisa en el propio título de la pestaña. Un integrador que prueba
      // contra staging creyendo que es producción es un incidente esperando a ocurrir.
      theme: 'default',
      darkMode: true,
      hideDownloadButton: false,
      // Autenticación precargada con el esquema real, para que "probar" no exija leer antes cómo se
      // autentica: basta con pegar el token.
      authentication: { preferredSecurityScheme: 'access-token' },
    }),
  );

  logger.log(
    `Referencia interactiva (Scalar) en /${prefix}/reference · Swagger UI en /${prefix}/docs · contrato en /${prefix}/docs/openapi.json`,
  );

  if (env.NODE_ENV === 'production') {
    logger.warn(
      'API_DOCS_ENABLED=true en PRODUCCIÓN: el contrato describe rutas internas, roles y la forma de los datos. ' +
        'Restringe el acceso por red o apágalo.',
    );
  }
}
