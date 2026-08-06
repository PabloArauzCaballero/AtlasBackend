---
title: "Modelo de error"
type: "api"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - api
  - errors
source_files:
  - "src/common/filters/http-exception.filter.ts"
  - "src/common/database/postgres-error.ts"
aliases: []
related: []
---

# Modelo de error

Un único filtro global, `HttpExceptionFilter`, traduce **toda** excepción a una respuesta HTTP.

## Principio: el cliente ve poco, el log ve todo

> [!info] Verificado
> El filtro construye **dos** mensajes distintos para el mismo error:
>
> - `buildErrorMessage()` → lo que ve el cliente. Saneado: sin tabla, sin columna, sin valores.
> - `buildInternalCause()` → lo que va al log. Incluye el mensaje del driver y el código SQLSTATE, desenvolviendo `original`/`parent` de los errores de Sequelize.
>
> Es la diferencia entre un 500 útil para operar y una fuga de estructura interna hacia fuera.

> [!danger] El SQL nunca se registra
> El comentario del código lo justifica: *"Sequelize inlinea valores en la consulta y podría filtrar datos sensibles al log"*. En un backend KYC, ese SQL llevaría nombres, teléfonos y documentos de identidad en claro al pipeline de logs, que además se sincroniza a MongoDB.
>
> Consecuencia para quien depura: **no esperes ver la consulta en el log**. Tienes el mensaje del driver y el SQLSTATE; el SQL hay que reconstruirlo desde el repositorio.

## Traducción de errores

| Origen | Respuesta al cliente |
|---|---|
| `HttpException` de Nest | Su propio estado y mensaje (los arrays de mensajes se unen con `, `) |
| Error de PostgreSQL | `normalizePostgresError()` mapea el SQLSTATE a un mensaje ya saneado del catálogo |
| `UniqueConstraintError` (Sequelize) | *"El recurso ya existe o viola una restricción única."* |
| `ValidationError` (Sequelize) | *"La operación viola una restricción de datos."* |
| Cualquier otra cosa | *"Error interno no controlado."* |

El mapeo SQLSTATE → mensaje vive en `src/common/database/postgres-error.ts` y está documentado en `docs/database/postgres-error-mapping.md`.

## Forma de la respuesta de error

Todo error sale con la misma estructura, simétrica a la de éxito:

```json
{
  "requestId": "3f8a…",
  "error": { "code": "…", "message": "…", "issues": [] },
  "timestamp": "2026-08-06T12:00:00.000Z"
}
```

`requestId` está también aquí: un error se puede rastrear en los logs con el mismo identificador que devolvió al cliente. La declaración única de ambas formas en el contrato es el objeto de [[02-architecture/adr/0007-contrato-openapi-enriquecido|ADR-0007]].

## Errores de validación

`ZodValidationPipe` produce `400` y rellena `issues` con los problemas por campo (`{ path, message }`), de modo que el cliente sepa **qué** campo falló y por qué, sin exponer la estructura interna.

## Códigos de estado en uso

Extraídos de los decoradores `@ApiResponse` de los controllers:

| Código | Cuándo |
|---|---|
| `200` / `201` | Éxito; `201` en creación (`@HttpCode(HttpStatus.CREATED)`) |
| `400` | Validación Zod fallida, cabecera obligatoria ausente (p. ej. `X-Idempotency-Key`), `x-tenant-id` mal formado |
| `401` | Token ausente, mal formado, expirado, revocado, o con rol desconocido |
| `403` | Rol insuficiente (`RolesGuard`), tenant contradictorio (`TenantGuard`), o recurso de otro cliente (anti-BOLA) |
| `404` | Recurso inexistente o no visible para el actor |
| `409` | Conflicto de idempotencia o de estado |
| `422` | Regla de negocio incumplida (p. ej. `CUSTOMER_BLOCKED`) |
| `429` | Rate limit excedido (`ThrottlerGuard`) |
| `500` | Error no controlado — mensaje saneado |
| `503` | Readiness negativo, o request cortado por `RequestTimeoutInterceptor` |

> [!info] 422 frente a 400
> `400` es "tu petición está mal formada"; `422` es "tu petición es válida pero el estado del sistema no permite la operación". Ejemplo real: `POST /customers/:id/sessions/start` devuelve `422 CUSTOMER_BLOCKED` cuando el cliente existe y el cuerpo es correcto pero está bloqueado.

## Distinguir un 503 de otro

Ambos son `503` pero significan cosas distintas:

- **Readiness negativo** — la instancia no puede atender; el cuerpo trae `checks` con el detalle por dependencia.
- **Timeout de request** — la instancia está sana, pero *esa* operación superó su techo de tiempo.

El segundo **sí** queda registrado en las métricas: `RequestTimeoutInterceptor` va justo dentro de `HttpMetricsInterceptor` precisamente para que el 503 por timeout no desaparezca de las series.

## Errores en el trabajo de fondo

Un job no tiene cliente al que responder. Los fallos se registran en `platform_ops.system_job_runs`, y un evento que falla queda en `outbox_events` con `status='failed'`. Ver [[07-async-processing/retry-and-dead-letter]].

## Relaciones

- [[04-api/conventions]] · [[15-reference/error-catalog]] · [[09-observability/logging]]
