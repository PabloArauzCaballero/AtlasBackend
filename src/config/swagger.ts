/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { enrichOpenApiDocument } from './openapi/enrich-document.js';
import { CONTRACT_TAGS } from './openapi/contract-tags.js';

/**
 * Builder oficial de OpenAPI para `/docs` y para `docs/endpoints/openapi.yaml`.
 *
 * Las rutas se detectan desde los decoradores HTTP de Nest; los módulos con decoradores Swagger
 * específicos aportan descripciones enriquecidas al contrato generado.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Atlas API')
    .setDescription(
      'API de Proyecto Atlas: identidad de cliente, autenticación, sesiones, consentimientos, ' +
        'privacidad, telemetría, riesgo/scoring, onboarding, elegibilidad crediticia y plataforma ' +
        'administrativa. Incluye catálogos versionados, definiciones semánticas y glosario de ' +
        'negocio para dar contexto trazable al motor de decisión. El dominio de crédito cubre el ' +
        'catálogo de productos y el ciclo de solicitud y decisión; compras, cuotas y comercios ' +
        'permanecen fuera del alcance actual.',
    )
    .setVersion('0.3.0')
    // OpenAPI 3.1 alinea el contrato con JSON Schema 2020-12: `examples` por esquema, `const`,
    // `nullable` sustituido por uniones de tipo. Redocly y Scalar lo consumen nativamente y es lo que
    // pide el estándar del proyecto. Nest emite 3.0.0 salvo que se le indique lo contrario.
    .setOpenAPIVersion('3.1.0')
    .setContact('Equipo Backend Atlas', 'https://github.com/PabloArauzCaballero/AtlasBackend', 'backend@atlas.local')
    .setLicense('UNLICENSED', 'https://github.com/PabloArauzCaballero/AtlasBackend')
    // Los servidores son parte del contrato: sin ellos, Scalar no sabe contra qué host disparar una
    // prueba y cada integrador inventa el suyo.
    .addServer('http://localhost:3005', 'Desarrollo local')
    .addServer('https://api.staging.atlas.local', 'Staging')
    .addServer('https://api.atlas.local', 'Producción')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();

  // Las 35 etiquetas EN USO se declaran globalmente y en el orden del recorrido de negocio. Nest
  // emite `tags` por operación desde `@ApiTags` pero no genera la lista global: sólo 3 de las 35
  // estaban declaradas, y `redocly lint` fallaba con 96 errores `operation-tag-defined`.
  config.tags = CONTRACT_TAGS.map((tag) => ({ name: tag.name, description: tag.description }));

  // El documento que devuelve Nest describe cada endpoint por separado; `enrichOpenApiDocument`
  // añade lo transversal (sobre de éxito, modelo de error, 429/500 globales) que ningún decorador
  // por endpoint puede aportar sin repetirse 263 veces. Ver src/config/openapi/enrich-document.ts.
  return enrichOpenApiDocument(SwaggerModule.createDocument(app, config));
}
