---
title: "API — auth"
type: "api"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/auth"
source_files:
  - "src/modules/auth/auth.controller.ts"
endpoints:
  - "POST /auth/login"
  - "POST /auth/login/pin"
  - "POST /auth/password-reset/request"
  - "POST /auth/password-reset/confirm"
  - "POST /auth/refresh"
  - "POST /auth/logout"
  - "GET /auth/me"
  - "POST /auth/mfa"
  - "POST /auth/provision-credentials"
---
# API — `auth`

9 endpoint(s), de los cuales **7 son públicos** (sin JWT).

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/auth/login` | 🔓 Público | — | `{ default: { ttl: 60_000, limit: 10 } }` | 200, 400, 401 | Login |
| `POST` | `/auth/login/pin` | 🔓 Público | — | `{ default: { ttl: 60_000, limit: 10 } }` | 200, 401 | Verificar PIN de login |
| `POST` | `/auth/password-reset/request` | 🔓 Público | — | `{ default: { ttl: 60_000, limit: 5 } }` | 200, 503 | Solicitar cambio de contraseña |
| `POST` | `/auth/password-reset/confirm` | 🔓 Público | — | `{ default: { ttl: 60_000, limit: 5 } }` | 200, 401 | Confirmar cambio de contraseña |
| `POST` | `/auth/refresh` | 🔓 Público | — | `{ default: { ttl: 60_000, limit: 30 } }` | 200, 401 | Refresh |
| `POST` | `/auth/logout` | 🔓 Público | — | — | 200 | Logout |
| `GET` | `/auth/me` | 🔒 JWT | — | — | 200, 401 | Identidad del actor autenticado |
| `POST` | `/auth/mfa` | 🔒 JWT | — | — | 200, 403, 503 | Activar/desactivar MFA (cliente) |
| `POST` | `/auth/provision-credentials` | 🔓 Público | `admin`<br>`platform_admin` | — | 201, 401, 403, 409 | Provisionar credenciales |

> [!danger] Superficie pública
> Estos endpoints no exigen JWT y son alcanzables por cualquiera que llegue al servicio: `POST /auth/login`, `POST /auth/login/pin`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/provision-credentials`. Su protección depende del rate limiting y de la validación Zod. Ver [[08-security/threat-model]].

## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/auth/auth.controller.ts`](../../../../src/modules/auth/auth.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
