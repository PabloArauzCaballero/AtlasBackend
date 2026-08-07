---
title: "API — health"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/health"
source_files:
  - "src/modules/health/health.controller.ts"
endpoints:
  - "GET /health"
  - "GET /health/liveness"
  - "GET /health/readiness"
---
# API — `health`

3 endpoint(s), de los cuales **3 son públicos** (sin JWT).

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/health` | 🔓 Público | — | — | 200 | Health check del servicio (público, sin auth) |
| `GET` | `/health/liveness` | 🔓 Público | — | — | 200 | Liveness probe (¿el proceso está vivo?) |
| `GET` | `/health/readiness` | 🔓 Público | — | — | 200, 503 | Readiness probe (¿puede atender tráfico?) |

> [!danger] Superficie pública
> Estos endpoints no exigen JWT y son alcanzables por cualquiera que llegue al servicio: `GET /health`, `GET /health/liveness`, `GET /health/readiness`. Su protección depende del rate limiting y de la validación Zod. Ver [[08-security/threat-model]].

## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/health/health.controller.ts`](../../../../../src/modules/health/health.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
