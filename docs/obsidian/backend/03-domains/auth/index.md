---
title: "auth"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "auth"
module: "AuthModule"
tags:
  - "backend"
  - "domain"
  - "module/auth"
source_files:
  - "src/modules/auth/auth.module.ts"
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
dependencies:
  - "CustomersModule"
  - "MailSenderModule"
---
# Módulo `auth`

Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.

**Papel técnico:** resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.

| | |
|---|---|
| Clase | `AuthModule` |
| Archivos | 8 |
| Controllers | 1 |
| Rutas HTTP | 9 (**7 públicas**) |
| Modelos usados | 7 |
| Esquemas de datos | [[iam-schema\|iam]], [[telemetry-schema\|telemetry]], [[audit-schema\|audit]] |

## Entradas

9 rutas HTTP. Contrato completo en [[04-api/rest/auth\|auth]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `POST` | `/auth/login` | 🔓 | — |
| `POST` | `/auth/login/pin` | 🔓 | — |
| `POST` | `/auth/password-reset/request` | 🔓 | — |
| `POST` | `/auth/password-reset/confirm` | 🔓 | — |
| `POST` | `/auth/refresh` | 🔓 | — |
| `POST` | `/auth/logout` | 🔓 | — |
| `GET` | `/auth/me` | 🔒 | — |
| `POST` | `/auth/mfa` | 🔒 | — |
| `POST` | `/auth/provision-credentials` | 🔓 | `admin` `platform_admin` |

## Salidas y efectos

Persiste en 7 tabla(s):

- [[auth_credentials]] (`iam`)
- [[auth_events]] (`telemetry`)
- [[auth_one_time_codes]] (`iam`)
- [[auth_refresh_tokens]] (`iam`)
- [[internal_users]] (`iam`)
- [[operational_audit_logs]] (`audit`)
- [[platform_users]] (`iam`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]], [[03-domains/mail-sender/index\|mail-sender]]

**Del que dependen:** [[03-domains/customer-onboarding/index\|customer-onboarding]], [[03-domains/internal-users/index\|internal-users]]

**Exporta:** `AuthService`, `AuthRepository`

> [!warning] Exporta un repositorio
> Otros módulos pueden llegar a la persistencia de este dominio sin pasar por su servicio, saltándose las reglas que vivan ahí. La regla del proyecto solo lo admite con necesidad transaccional real y documentada.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `auth.controller.ts` |
| Services | `auth-actor-resolver.service.ts`, `auth-password-reset.service.ts`, `auth.service.ts` |
| Repositories | `auth.repository.ts` |
| Esquemas Zod | `auth.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `admin`, `platform_admin`.

> [!danger] Superficie pública
> 7 ruta(s) sin JWT: `POST /auth/login`, `POST /auth/login/pin`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/provision-credentials`.

## Pruebas

14 archivo(s) de test:

- `test/unit/auth/auth-actor-resolver.service.spec.ts`
- `test/unit/auth/auth-password-reset.service.spec.ts`
- `test/unit/auth/auth-repository-email-lookup.spec.ts`
- `test/unit/auth/auth.controller.spec.ts`
- `test/unit/auth/auth.repository.spec.ts`
- `test/unit/auth/auth.service.spec.ts`
- `test/unit/auth/ownership.util.spec.ts`
- `test/unit/auth/password.util.spec.ts`
- `test/unit/auth/refresh-token.util.spec.ts`
- `test/unit/auth/token-revocation.service.spec.ts`
- `test/unit/common/guards/jwt-auth.guard.spec.ts`
- `test/unit/common/utils/auth-cookies.util.spec.ts`
- `test/unit/internal-users/internal-auth.controller.spec.ts`
- `test/unit/openapi/auth-openapi.spec.ts`

## Referencias al código

- Módulo: [`src/modules/auth/auth.module.ts`](../../../../../src/modules/auth/auth.module.ts)
- Controller `AuthController`: [`src/modules/auth/auth.controller.ts`](../../../../../src/modules/auth/auth.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
