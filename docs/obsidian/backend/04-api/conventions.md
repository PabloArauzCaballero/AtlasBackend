---
title: "Convenciones de API"
type: "api"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - api
  - conventions
source_files:
  - "src/main.ts"
  - "src/common/interceptors/response.interceptor.ts"
  - "src/common/middleware/correlation-id.middleware.ts"
aliases: []
related: []
---

# Convenciones de API

## Prefijo y versionado

Todas las rutas cuelgan de `API_PREFIX` (por defecto `api/v1`). **Única excepción:** `/metrics`, excluido explícitamente en `main.ts:72` para respetar la convención de *scrape* de Prometheus.

El versionado es por prefijo de ruta, no por cabecera ni por contenido. No hay `v2`. Ver [[04-api/versioning]].

## Envoltura de respuesta

Toda respuesta exitosa pasa por `ResponseInterceptor`:

```json
{
  "requestId": "3f8a…",
  "data": { },
  "timestamp": "2026-08-06T12:00:00.000Z"
}
```

| Campo | Origen |
|---|---|
| `requestId` | El `correlationId` del request (`CorrelationIdMiddleware`) |
| `data` | Lo que devuelve el handler del controller |
| `timestamp` | Instante de la respuesta, ISO-8601 |

> [!info] Por qué `requestId` viaja en la respuesta
> Es el mismo identificador que aparece en las líneas de log y en la traza. Un usuario que reporta un fallo puede dar ese valor y el operador encuentra exactamente ese request. Ver [[09-observability/correlation-ids]].

Los errores **no** llevan esta envoltura: los produce `HttpExceptionFilter` con su propia forma. Ver [[04-api/error-model]].

## Cabeceras

| Cabecera | Dirección | Obligatoria | Propósito |
|---|---|---|---|
| `Authorization: Bearer <token>` | Entrada | Alternativa a la cookie | Autenticación |
| Cookie de sesión | Entrada | Alternativa a `Authorization` | Autenticación — **tiene prioridad** sobre la cabecera |
| `x-tenant-id` | Entrada | Según ruta | Debe coincidir con el `tenantId` del token si ambos están presentes |
| `x-idempotency-key` | Entrada | En comandos que la exigen | Deduplicación de `POST`/`PUT`/`PATCH`/`DELETE` |
| `x-correlation-id` | Entrada/salida | No | Si el cliente la envía, se propaga; si no, se genera |

## Cuerpo de la petición

Límite configurable con `API_JSON_BODY_LIMIT`, **2 MB** por defecto, tanto para `json` como para `urlencoded`.

> [!info] Por qué 2 MB y no los 100 KB de Express
> El contrato de ingesta de catálogos admite hasta 1 000 ítems por request. El límite por defecto de Express rechazaba lotes válidos **antes** de que llegaran al `ZodValidationPipe`, produciendo un error de transporte donde debía haber una validación de dominio.

## Validación

Todo endpoint valida su entrada con `ZodValidationPipe` sobre esquemas Zod declarados en el `*.schemas.ts` del módulo. El mismo esquema genera la documentación OpenAPI vía `zodToApiSchema()`: **el contrato publicado y la validación real no pueden divergir**, porque son el mismo objeto.

## Idempotencia

Ver [[02-architecture/critical-sequences]]. En resumen: `x-idempotency-key` + hash del `(body, query, params)`, con ámbito por tenant y por `MÉTODO + URL`. Solo aplica a métodos de escritura.

## Paginación

Por **cursor**, no por *offset*. Ver [[04-api/pagination-filtering-sorting]] y [[02-architecture/adr/0005-paginacion-por-cursor|ADR-0005]].

## Rate limiting

Global vía `ThrottlerGuard` con `API_RATE_LIMIT_TTL_MS` / `API_RATE_LIMIT_MAX`, y `@Throttle` más estricto en los endpoints públicos de autenticación. Con Redis configurado el contador es **compartido entre instancias**; sin él, cada instancia cuenta por su lado. Ver [[04-api/rate-limits]].

## Seguridad de transporte

- `helmet()` — HSTS, `X-Frame-Options`, `X-Content-Type-Options`, CSP.
- `compression()` — respeta `Accept-Encoding`, comprime por encima de 1 KB.
- `trust proxy = 1` — para que `req.ip` sea real detrás de un balanceador.
- CORS con lista explícita: `CORS_ORIGINS` ∪ `INTERNAL_FRONTEND_ORIGIN`, con `credentials: true` (necesario para la cookie de sesión).

## Documentación interactiva

`setupApiDocumentation()` publica Scalar, Swagger UI y el contrato crudo bajo `/api/v1/docs`, condicionado a `API_DOCS_ENABLED` — cuyo default es `NODE_ENV !== 'production'`.

## Nomenclatura de rutas

`VERIFICADO` — patrón consistente:

- Recursos en plural: `/customers`, `/sessions`, `/notifications`.
- Anidamiento por pertenencia: `/customers/:customerId/sessions/start`.
- Acciones como sufijo verbal cuando no son CRUD: `/auth/password-reset/request`, `/auth/password-reset/confirm`.
- Rutas internas con prefijo de ámbito: `/internal/...`, `/operations/...`, `/systems/...`.

## Relaciones

- [[04-api/index]] · [[04-api/authentication]] · [[04-api/error-model]] · [[15-reference/endpoint-catalog]]
