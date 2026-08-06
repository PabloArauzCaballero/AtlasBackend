---
title: "audit"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "audit"
module: "AuditModule"
tags:
  - "backend"
  - "domain"
  - "module/audit"
source_files:
  - "src/modules/audit/audit.module.ts"
  - "src/modules/audit/audit.controller.ts"
endpoints:
  - "GET /operations/audit/customer/:customerId"
  - "GET /operations/audit/customer/:customerId/feed"
dependencies: []
---
# Módulo `audit`

Esta pieza aporta trazabilidad verificable de acciones y cambios para investigación, cumplimiento y soporte.

**Papel técnico:** consolida consultas y persistencia de eventos de auditoría sin exponer modelos ORM al transporte.

| | |
|---|---|
| Clase | `AuditModule` |
| Archivos | 6 |
| Controllers | 1 |
| Rutas HTTP | 2 |
| Modelos usados | 13 |
| Esquemas de datos | [[telemetry-schema\|telemetry]], [[privacy-schema\|privacy]], [[customer-schema\|customer]], [[audit-schema\|audit]], [[case_management-schema\|case_management]], [[platform_ops-schema\|platform_ops]] |

## Entradas

2 rutas HTTP. Contrato completo en [[04-api/rest/audit\|audit]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/operations/audit/customer/:customerId` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `GET` | `/operations/audit/customer/:customerId/feed` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |

## Salidas y efectos

Persiste en 13 tabla(s):

- [[auth_events]] (`telemetry`)
- [[consent_events]] (`privacy`)
- [[customer_action_logs]] (`telemetry`)
- [[customer_consents]] (`privacy`)
- [[customer_status_events]] (`customer`)
- [[data_change_logs]] (`audit`)
- [[fraud_case_events]] (`case_management`)
- [[fraud_cases]] (`case_management`)
- [[manual_review_cases]] (`case_management`)
- [[manual_review_events]] (`case_management`)
- [[operational_audit_logs]] (`audit`)
- [[system_action_logs]] (`platform_ops`)
- [[system_endpoint_catalog]] (`platform_ops`)

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** `HttpActionLogService`

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `audit.controller.ts` |
| Services | `audit.service.ts`, `http-action-log.service.ts` |
| Repositories | `audit.repository.ts` |
| Esquemas Zod | `audit.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`.


## Pruebas

7 archivo(s) de test:

- `test/unit/audit/audit-cursor.spec.ts`
- `test/unit/audit/audit-repository-event-types.spec.ts`
- `test/unit/audit/audit.controller.spec.ts`
- `test/unit/audit/audit.repository.spec.ts`
- `test/unit/audit/audit.service.spec.ts`
- `test/unit/audit/http-action-log.service.spec.ts`
- `test/unit/sessions/sessions-activity-audit.repository.spec.ts`

## Referencias al código

- Módulo: [`src/modules/audit/audit.module.ts`](../../../../src/modules/audit/audit.module.ts)
- Controller `AuditController`: [`src/modules/audit/audit.controller.ts`](../../../../src/modules/audit/audit.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
