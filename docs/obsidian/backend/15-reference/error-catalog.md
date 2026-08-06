---
title: "Catálogo de errores"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - reference
  - errors
aliases: []
related: []
---
# Catálogo de errores

La forma de la respuesta y la traducción de excepciones están en [[04-api/error-model]].

## Por código HTTP

| Código | Nombre | Origen | Reintentable |
|---|---|---|---|
| 400 | Bad Request | `ZodValidationPipe`; cabecera obligatoria ausente; `x-tenant-id` mal formado | No — corregir la petición |
| 401 | Unauthorized | `JwtAuthGuard`: sin token, formato inválido, expirado, revocado, rol desconocido | Tras renovar el token |
| 403 | Forbidden | `RolesGuard`; `TenantGuard`; ownership anti-BOLA | No |
| 404 | Not Found | Recurso inexistente **o** no visible para el actor | No |
| 409 | Conflict | Conflicto de idempotencia o de estado | Depende |
| 422 | Unprocessable Entity | Regla de negocio incumplida (p. ej. `CUSTOMER_BLOCKED`) | Tras resolver la condición |
| 429 | Too Many Requests | `ThrottlerGuard` | Sí, con espera |
| 500 | Internal Server Error | No controlado — mensaje **saneado** | Sí |
| 503 | Service Unavailable | Readiness negativo **o** timeout de request | Sí |

## Errores de PostgreSQL

`normalizePostgresError()` mapea el SQLSTATE a un mensaje ya saneado, **sin tabla, columna ni valores**. El catálogo completo está en `src/common/database/postgres-error.ts` y en `docs/database/postgres-error-mapping.md`.

| Origen Sequelize | Mensaje al cliente |
|---|---|
| `UniqueConstraintError` | *"El recurso ya existe o viola una restricción única."* |
| `ValidationError` | *"La operación viola una restricción de datos."* |
| Sin clasificar | *"Error interno no controlado."* |

## Distinguir los dos 503

| Caso | Señal |
|---|---|
| Readiness negativo | El cuerpo trae `checks` por dependencia |
| Timeout de request | La instancia está sana; solo esa operación superó su techo |

El segundo **sí** queda en las métricas: `RequestTimeoutInterceptor` va dentro de `HttpMetricsInterceptor` para que no desaparezca de las series.

## Errores de adaptador externo

`adapter-error.ts` define el error tipado. Un circuito abierto falla **rápido**: no es un timeout, es una negativa deliberada a llamar. Ver [[10-operations/runbooks/proveedor-externo-caido]].

## Errores del trabajo de fondo

Un job no tiene cliente al que responder: los fallos van a `system_job_runs`, y un evento fallido queda con `status='failed'` en el outbox.

## Relaciones

- [[04-api/error-model]] · [[09-observability/logging]] · [[10-operations/runbooks/index]]
