---
title: "internal-users"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "internal-users"
module: "InternalUsersModule"
tags:
  - "backend"
  - "domain"
  - "module/internal-users"
source_files:
  - "src/modules/internal-users/internal-users.module.ts"
  - "src/modules/internal-users/internal-access-catalog.controller.ts"
  - "src/modules/internal-users/internal-auth.controller.ts"
  - "src/modules/internal-users/internal-users.controller.ts"
endpoints:
  - "GET /internal/roles"
  - "GET /internal/roles/:roleId"
  - "GET /internal/permissions"
  - "POST /internal/auth/login"
  - "POST /internal/auth/login/pin"
  - "POST /internal/auth/refresh"
  - "POST /internal/auth/logout"
  - "GET /internal/auth/me"
  - "POST /internal/auth/signup"
  - "GET /internal/users"
  - "GET /internal/users/:internalUserId"
  - "PATCH /internal/users/:internalUserId"
  - "PATCH /internal/users/:internalUserId/roles"
dependencies:
  - "AuthModule"
---
# Módulo `internal-users`

Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.

**Papel técnico:** implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.

| | |
|---|---|
| Clase | `InternalUsersModule` |
| Archivos | 18 |
| Controllers | 3 |
| Rutas HTTP | 13 (**4 públicas**) |
| Modelos usados | 7 |
| Esquemas de datos | [[iam-schema\|iam]], [[audit-schema\|audit]] |

## Entradas

13 rutas HTTP. Contrato completo en [[04-api/rest/internal-access-catalog\|internal-access-catalog]], [[04-api/rest/internal-auth\|internal-auth]], [[04-api/rest/internal-users\|internal-users]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/internal/roles` | 🔒 | — |
| `GET` | `/internal/roles/:roleId` | 🔒 | — |
| `GET` | `/internal/permissions` | 🔒 | — |
| `POST` | `/internal/auth/login` | 🔓 | — |
| `POST` | `/internal/auth/login/pin` | 🔓 | — |
| `POST` | `/internal/auth/refresh` | 🔓 | — |
| `POST` | `/internal/auth/logout` | 🔓 | — |
| `GET` | `/internal/auth/me` | 🔒 | — |
| `POST` | `/internal/auth/signup` | 🔒 | — |
| `GET` | `/internal/users` | 🔒 | — |
| `GET` | `/internal/users/:internalUserId` | 🔒 | — |
| `PATCH` | `/internal/users/:internalUserId` | 🔒 | — |
| `PATCH` | `/internal/users/:internalUserId/roles` | 🔒 | — |

## Salidas y efectos

Persiste en 7 tabla(s):

- [[auth_credentials]] (`iam`)
- [[internal_permissions]] (`iam`)
- [[internal_roles]] (`iam`)
- [[internal_role_permissions]] (`iam`)
- [[internal_users]] (`iam`)
- [[internal_user_roles]] (`iam`)
- [[operational_audit_logs]] (`audit`)

## Dependencias

**Depende de:** [[03-domains/auth/index\|auth]]

**Del que dependen:** [[03-domains/notifications/index\|notifications]]

**Exporta:** `InternalUsersService`, `InternalAccessCatalogService`, `InternalRbacRepository`, `InternalAccessCatalogRepository`

> [!warning] Exporta un repositorio
> Otros módulos pueden llegar a la persistencia de este dominio sin pasar por su servicio, saltándose las reglas que vivan ahí. La regla del proyecto solo lo admite con necesidad transaccional real y documentada.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `internal-access-catalog.controller.ts`, `internal-auth.controller.ts`, `internal-users.controller.ts` |
| Services | `internal-access-catalog.service.ts`, `internal-auth.service.ts`, `internal-users.service.ts` |
| Repositories | `internal-access-catalog.repository.ts`, `internal-rbac.repository.ts` |
| Esquemas Zod | `internal-access-catalog.schemas.ts`, `internal-users.schemas.ts` |
| Mappers | — |

## Autorización

Sin rutas HTTP: no aplica autorización de transporte.

> [!danger] Superficie pública
> 4 ruta(s) sin JWT: `POST /internal/auth/login`, `POST /internal/auth/login/pin`, `POST /internal/auth/refresh`, `POST /internal/auth/logout`.

## Pruebas

10 archivo(s) de test:

- `test/unit/internal-users/internal-access-catalog.controller.spec.ts`
- `test/unit/internal-users/internal-access-catalog.repository.spec.ts`
- `test/unit/internal-users/internal-access-catalog.service.spec.ts`
- `test/unit/internal-users/internal-auth.controller.spec.ts`
- `test/unit/internal-users/internal-permissions.guard.spec.ts`
- `test/unit/internal-users/internal-rbac-repository-active-ids.spec.ts`
- `test/unit/internal-users/internal-rbac.repository.spec.ts`
- `test/unit/internal-users/internal-rbac.seed-data.spec.ts`
- `test/unit/internal-users/internal-users.controller.spec.ts`
- `test/unit/internal-users/internal-users.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/internal-users/internal-users.module.ts`](../../../../src/modules/internal-users/internal-users.module.ts)
- Controller `InternalAccessCatalogController`: [`src/modules/internal-users/internal-access-catalog.controller.ts`](../../../../src/modules/internal-users/internal-access-catalog.controller.ts)
- Controller `InternalAuthController`: [`src/modules/internal-users/internal-auth.controller.ts`](../../../../src/modules/internal-users/internal-auth.controller.ts)
- Controller `InternalUsersController`: [`src/modules/internal-users/internal-users.controller.ts`](../../../../src/modules/internal-users/internal-users.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
