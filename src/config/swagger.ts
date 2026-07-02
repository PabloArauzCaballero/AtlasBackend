import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, OpenAPIObject } from '@nestjs/swagger';

/**
 * ATLAS-AUDIT-006 (cerrado en este patch): no existía ningún Swagger/OpenAPI en el proyecto
 * pese a que `BACKEND_DEVELOPMENT_CONTEXT.md` §1 y §16 lo exigen, ni el archivo obligatorio
 * `docs/endpoints/openapi.yaml`.
 *
 * Esta función construye el documento OpenAPI una sola vez, para dos consumidores:
 *  - `main.ts`: lo monta en `${API_PREFIX}/docs` como UI interactiva (Swagger UI).
 *  - `scripts/generate-openapi.ts`: lo exporta a `docs/endpoints/openapi.yaml` para que quede
 *    versionado y sea el contrato que consumen los equipos de frontend web y mobile.
 *
 * Nota de cobertura: los DTOs/controladores de `auth` están decorados con `@ApiProperty`/
 * `@ApiOperation`. Los 15 módulos preexistentes (customers, sessions, risk, etc.) NO tienen
 * decoradores Swagger todavía — sus rutas SÍ aparecen en el documento generado (Nest las
 * detecta por los decoradores HTTP estándar de `@Controller`/`@Get`/`@Post`), pero sin
 * descripciones enriquecidas. Retrofit completo de anotaciones queda documentado como pendiente
 * en `docs/pending/pending-items.md` (ATLAS-AUDIT-006) — agregarlo módulo por módulo es trabajo
 * mecánico de bajo riesgo, no bloqueante para tener el mecanismo funcionando.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Atlas API')
    .setDescription(
      'API de Proyecto Atlas — Fase 1 (usuarios): identidad de cliente, autenticación, sesiones, ' +
        'consentimientos, privacidad, telemetría, riesgo/scoring y plataforma administrativa. ' +
        'El dominio BNPL (compras, cuotas, línea de crédito, comercios) corresponde a Fase 3 y ' +
        'todavía no está implementado — ver docs/pending/pending-items.md.',
    )
    .setVersion('0.2.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('auth', 'Autenticación: login, refresh, logout, provisión de credenciales internas.')
    .build();

  return SwaggerModule.createDocument(app, config);
}
