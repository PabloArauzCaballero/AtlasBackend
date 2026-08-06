---
title: "Matriz de permisos"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "reference"
  - "security"
  - "rbac"
source_files:
  - "src/common/types/auth.types.ts"
  - "src/common/guards/roles.guard.ts"
  - "src/modules/internal-users/internal-rbac.roles.ts"
---
# Matriz de permisos

## Dos vocabularios de rol distintos

> [!info] Verificado
> Atlas distingue **el rol del token** del **rol organizacional**:
>
> 1. **`AtlasUserRole`** — 13 valores, el claim `role` del JWT. Fuente única: `ATLAS_USER_ROLES` en [`src/common/types/auth.types.ts`](../../../src/common/types/auth.types.ts). Es lo que evalúa `@Roles(...)` + `RolesGuard`.
> 2. **`InternalRoleCode`** — 20 roles internos de negocio (`SUPER_ADMIN`, `RISK_ANALYST`, …) en [`src/modules/internal-users/internal-rbac.roles.ts`](../../../src/modules/internal-users/internal-rbac.roles.ts), persistidos en `iam.internal_roles`. Cada uno mapea a un `legacyRoleCode` del vocabulario anterior.
>
> El comentario del propio código explica por qué la lista está centralizada: antes existía triplicada (tipo, guard y resolver), y añadir un rol en un sitio y olvidarlo en otro producía "un rol que el resolver acepta pero el guard rechaza".

## Cobertura por rol de token

| Rol (`AtlasUserRole`) | Endpoints alcanzables | Lectura |
|---|---:|---|
| `platform_admin` | 140 |  |
| `admin` | 139 |  |
| `risk_analyst` | 106 |  |
| `internal_operator` | 100 |  |
| `system` | 76 |  |
| `compliance_analyst` | 73 |  |
| `(sin @Roles)` | 54 | Rutas sin restricción de rol: públicas o protegidas solo por JWT |
| `fraud_analyst` | 50 |  |
| `customer` | 50 |  |
| `...INTERNAL_PORTAL_ROLES` | 24 |  |
| `...SYSTEMS_OPS_GOVERNANCE_ROLES` | 11 |  |
| `...CUSTOMER_AND_INTERNAL` | 8 |  |
| `...ADMIN_READ_ROLES` | 7 |  |
| `...WORKFLOW_CATALOG_READ_ROLES` | 7 |  |
| `...SYSTEMS_OPS_QA_ROLES` | 6 |  |
| `readonly_auditor` | 5 |  |
| `...INTERNAL_SELF_SERVICE_ROLES` | 4 |  |
| `...SYSTEMS_OPS_STRESS_ROLES` | 2 |  |
| `...` | 1 |  |
| `...WORKFLOW_CATALOG_GOVERNANCE_ROLES` | 1 |  |
| `...WORKFLOW_PROGRESS_ROLES` | 1 |  |

## Roles internos de negocio

| Código | Rol de token equivalente |
|---|---|
| `SUPER_ADMIN` | `admin` |
| `SYSTEMS_ADMIN` | `admin` |
| `INTERNAL_IDENTITY_ADMIN` | `admin` |
| `OPERATIONS_MANAGER` | `internal_operator` |
| `OPERATIONS_ANALYST` | `internal_operator` |
| `RISK_MANAGER` | `risk_analyst` |
| `RISK_ANALYST` | `risk_analyst` |
| `FRAUD_ANALYST` | `fraud_analyst` |
| `COMPLIANCE_MANAGER` | `compliance_analyst` |
| `COMPLIANCE_ANALYST` | `compliance_analyst` |
| `COLLECTIONS_MANAGER` | `internal_operator` |
| `COLLECTIONS_AGENT` | `internal_operator` |
| `FINANCE_MANAGER` | `internal_operator` |
| `MERCHANT_OPERATIONS` | `internal_operator` |
| `DATA_GOVERNANCE_MANAGER` | `admin` |
| `DATA_QUALITY_ANALYST` | `internal_operator` |
| `QA_ENGINEER` | `qa_engineer` |
| `AUDITOR_READONLY` | `readonly_auditor` |
| `SUPPORT_AGENT` | `internal_operator` |
| `EXECUTIVE_READONLY` | `readonly_auditor` |

## Endpoints públicos (sin JWT)

| Método | Ruta | Rate limit |
|---|---|---|
| `POST` | `/auth/login` | `{ default: { ttl: 60_000, limit: 10 } }` |
| `POST` | `/auth/login/pin` | `{ default: { ttl: 60_000, limit: 10 } }` |
| `POST` | `/auth/password-reset/request` | `{ default: { ttl: 60_000, limit: 5 } }` |
| `POST` | `/auth/password-reset/confirm` | `{ default: { ttl: 60_000, limit: 5 } }` |
| `POST` | `/auth/refresh` | `{ default: { ttl: 60_000, limit: 30 } }` |
| `POST` | `/auth/logout` | `RIESGO` sin @Throttle explícito |
| `POST` | `/auth/provision-credentials` | `RIESGO` sin @Throttle explícito |
| `GET` | `/consent-documents/active` | `RIESGO` sin @Throttle explícito |
| `POST` | `/customer-onboarding/start` | `{ default: { ttl: 60_000, limit: 10 } }` |
| `GET` | `/health` | `RIESGO` sin @Throttle explícito |
| `GET` | `/health/liveness` | `RIESGO` sin @Throttle explícito |
| `GET` | `/health/readiness` | `RIESGO` sin @Throttle explícito |
| `POST` | `/internal/auth/login` | `RIESGO` sin @Throttle explícito |
| `POST` | `/internal/auth/login/pin` | `RIESGO` sin @Throttle explícito |
| `POST` | `/internal/auth/refresh` | `RIESGO` sin @Throttle explícito |
| `POST` | `/internal/auth/logout` | `RIESGO` sin @Throttle explícito |

## Relaciones

- [[08-security/authorization]] · [[08-security/authentication]] · [[15-reference/endpoint-catalog]]
