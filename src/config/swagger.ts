import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, OpenAPIObject } from '@nestjs/swagger';

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
        'privacidad, telemetría, riesgo/scoring y plataforma administrativa. Incluye catálogos ' +
        'versionados, definiciones semánticas y glosario de negocio para dar contexto trazable al motor de decisión. ' +
        'El dominio BNPL (compras, cuotas, línea de crédito, comercios) corresponde a Fase 3 y ' +
        'todavía no está implementado — ver docs/pending/pending-items.md.',
    )
    .setVersion('0.3.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('auth', 'Autenticación: login, refresh, logout, provisión de credenciales internas.')
    .addTag('catalog-management', 'Catálogos versionados, definiciones semánticas y mapeos de riesgo consumidos por el motor de decisión.')
    .addTag('internal-portal', 'Glosario de negocio, gobierno y trazabilidad para operadores internos.')
    .build();

  return SwaggerModule.createDocument(app, config);
}
