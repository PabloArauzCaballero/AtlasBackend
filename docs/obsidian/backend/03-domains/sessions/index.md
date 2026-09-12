---
title: "sessions"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "sessions"
module: "SessionsModule"
tags:
  - "backend"
  - "domain"
  - "module/sessions"
source_files:
  - "src/modules/sessions/sessions.module.ts"
  - "src/modules/sessions/sessions.controller.ts"
  - "src/modules/sessions/sessions.controller.ts"
endpoints:
  - "POST /customers/:customerId/sessions/start"
  - "POST /customers/:customerId/sessions/:sessionId/heartbeat"
  - "POST /customers/:customerId/sessions/:sessionId/end"
  - "GET /customers/:customerId/session-state"
  - "GET /operations/sessions/:sessionId/investigation-summary"
dependencies:
  - "CustomersModule"
---
# Módulo `sessions`

Esta pieza mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.

**Papel técnico:** orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.

| | |
|---|---|
| Clase | `SessionsModule` |
| Archivos | 19 |
| Controllers | 2 |
| Rutas HTTP | 5 |
| Modelos usados | 19 |
| Esquemas de datos | [[customer-schema\|customer]], [[telemetry-schema\|telemetry]], [[catalog-schema\|catalog]], [[audit-schema\|audit]] |

## Entradas

5 rutas HTTP. Contrato completo en [[04-api/rest/sessions\|sessions]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `POST` | `/customers/:customerId/sessions/start` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `POST` | `/customers/:customerId/sessions/:sessionId/heartbeat` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `POST` | `/customers/:customerId/sessions/:sessionId/end` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/customers/:customerId/session-state` | 🔒 | `customer` `internal_operator` `risk_analyst` `compliance_analyst` |
| `GET` | `/operations/sessions/:sessionId/investigation-summary` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |

## Salidas y efectos

Persiste en 19 tabla(s):

- [[address_gps_observations]] (`customer`)
- [[auth_events]] (`telemetry`)
- [[customer_action_logs]] (`telemetry`)
- [[customer_activity_summaries]] (`telemetry`)
- [[customer_addresses]] (`customer`)
- [[customer_address_versions]] (`customer`)
- [[customer_device_links]] (`telemetry`)
- [[customer_observations]] (`catalog`)
- [[customer_sessions]] (`telemetry`)
- [[devices]] (`telemetry`)
- [[device_risk_events]] (`telemetry`)
- [[device_snapshots]] (`telemetry`)
- [[global_device_fingerprints]] (`telemetry`)
- [[ip_reputation_observations]] (`telemetry`)
- [[onboarding_flows]] (`telemetry`)
- [[onboarding_step_events]] (`telemetry`)
- [[operational_audit_logs]] (`audit`)
- [[permission_events]] (`telemetry`)
- [[sim_observations]] (`telemetry`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]]

**Del que dependen:** [[03-domains/customer-onboarding/index\|customer-onboarding]]

**Exporta:** `SessionsRepository`, `SessionsService`

> [!warning] Exporta un repositorio
> Otros módulos pueden llegar a la persistencia de este dominio sin pasar por su servicio, saltándose las reglas que vivan ahí. La regla del proyecto solo lo admite con necesidad transaccional real y documentada.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `sessions.controller.ts` |
| Services | `sessions.service.ts`, `application/session-end.service.ts`, `application/session-gps-writer.service.ts`, `application/session-heartbeat.service.ts`, `application/session-query.service.ts`, `application/session-start.service.ts` |
| Repositories | `sessions.repository.ts`, `repositories/sessions-activity-audit.repository.ts`, `repositories/sessions-device.repository.ts`, `repositories/sessions-lifecycle.repository.ts`, `repositories/sessions-location.repository.ts`, `repositories/sessions-onboarding-link.repository.ts`, `repositories/sessions-telemetry.repository.ts` |
| Esquemas Zod | `sessions.schemas.ts` |
| Mappers | `sessions.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `customer`, `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`.


## Pruebas

15 archivo(s) de test:

- `test/unit/openapi/sessions-openapi.spec.ts`
- `test/unit/sessions/session-end.service.spec.ts`
- `test/unit/sessions/session-gps-writer.service.spec.ts`
- `test/unit/sessions/session-heartbeat.service.spec.ts`
- `test/unit/sessions/session-query.service.spec.ts`
- `test/unit/sessions/session-start.service.spec.ts`
- `test/unit/sessions/sessions-activity-audit.repository.spec.ts`
- `test/unit/sessions/sessions-device.repository.spec.ts`
- `test/unit/sessions/sessions-lifecycle.repository.spec.ts`
- `test/unit/sessions/sessions-location.repository.spec.ts`
- `test/unit/sessions/sessions-onboarding-link.repository.spec.ts`
- `test/unit/sessions/sessions-repository-facade.spec.ts`
- `test/unit/sessions/sessions-telemetry.repository.spec.ts`
- `test/unit/sessions/sessions.controller.spec.ts`
- `test/unit/sessions/sessions.mapper.spec.ts`

## Referencias al código

- Módulo: [`src/modules/sessions/sessions.module.ts`](../../../../../src/modules/sessions/sessions.module.ts)
- Controller `CustomerSessionsController`: [`src/modules/sessions/sessions.controller.ts`](../../../../../src/modules/sessions/sessions.controller.ts)
- Controller `OperationsSessionsController`: [`src/modules/sessions/sessions.controller.ts`](../../../../../src/modules/sessions/sessions.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
