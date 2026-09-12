---
title: "API — internal-auth"
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
  - "tag/internal-auth"
source_files:
  - "src/modules/internal-users/internal-auth.controller.ts"
endpoints:
  - "POST /internal/auth/login"
  - "POST /internal/auth/login/pin"
  - "POST /internal/auth/refresh"
  - "POST /internal/auth/logout"
  - "GET /internal/auth/me"
  - "POST /internal/auth/signup"
---
# API — `internal-auth`

6 endpoint(s), de los cuales **4 son públicos** (sin JWT).

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/internal/auth/login` | 🔓 Público | — | — | 200, 401 | Login interno |
| `POST` | `/internal/auth/login/pin` | 🔓 Público | — | — | 200, 401 | Verificar PIN de login interno |
| `POST` | `/internal/auth/refresh` | 🔓 Público | — | — | 200, 401 | Refresh interno |
| `POST` | `/internal/auth/logout` | 🔓 Público | — | — | 200 | Logout interno |
| `GET` | `/internal/auth/me` | 🔒 JWT | — | — | 200 | Perfil interno actual |
| `POST` | `/internal/auth/signup` | 🔒 JWT | — | — | 201 | Crear usuario interno |

> [!danger] Superficie pública
> Estos endpoints no exigen JWT y son alcanzables por cualquiera que llegue al servicio: `POST /internal/auth/login`, `POST /internal/auth/login/pin`, `POST /internal/auth/refresh`, `POST /internal/auth/logout`. Su protección depende del rate limiting y de la validación Zod. Ver [[08-security/threat-model]].

## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/internal-users/internal-auth.controller.ts`](../../../../../src/modules/internal-users/internal-auth.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
