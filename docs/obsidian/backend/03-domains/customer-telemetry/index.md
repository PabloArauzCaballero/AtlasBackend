---
title: "customer-telemetry"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "customer-telemetry"
module: "CustomerTelemetryModule"
tags:
  - "backend"
  - "domain"
  - "module/customer-telemetry"
source_files:
  - "src/modules/customer-telemetry/customer-telemetry.module.ts"
  - "src/modules/customer-telemetry/customer-telemetry.controller.ts"
endpoints:
  - "POST /customers/:customerId/telemetry/batch"
dependencies:
  - "CustomersModule"
---
# Módulo `customer-telemetry`

Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.

**Papel técnico:** valida e ingiere lotes de telemetría con límites, redacción y escritura transaccional.

| | |
|---|---|
| Clase | `CustomerTelemetryModule` |
| Archivos | 5 |
| Controllers | 1 |
| Rutas HTTP | 1 |
| Modelos usados | 17 |
| Esquemas de datos | [[telemetry-schema\|telemetry]], [[catalog-schema\|catalog]], [[audit-schema\|audit]] |

## Entradas

1 rutas HTTP. Contrato completo en [[04-api/rest/customer-telemetry\|customer-telemetry]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `POST` | `/customers/:customerId/telemetry/batch` | 🔒 | `customer` `internal_operator` `risk_analyst` `admin` |

## Salidas y efectos

Persiste en 17 tabla(s):

- [[auth_events]] (`telemetry`)
- [[customer_action_logs]] (`telemetry`)
- [[customer_activity_summaries]] (`telemetry`)
- [[customer_device_links]] (`telemetry`)
- [[customer_observations]] (`catalog`)
- [[customer_sessions]] (`telemetry`)
- [[device_risk_events]] (`telemetry`)
- [[form_field_interaction_events]] (`telemetry`)
- [[ip_reputation_observations]] (`telemetry`)
- [[on_device_computation_runs]] (`telemetry`)
- [[on_device_metric_values]] (`telemetry`)
- [[onboarding_behavior_summaries]] (`telemetry`)
- [[onboarding_flows]] (`telemetry`)
- [[onboarding_step_events]] (`telemetry`)
- [[operational_audit_logs]] (`audit`)
- [[permission_events]] (`telemetry`)
- [[sim_observations]] (`telemetry`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]]

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `customer-telemetry.controller.ts` |
| Services | `customer-telemetry.service.ts` |
| Repositories | `customer-telemetry.repository.ts` |
| Esquemas Zod | `customer-telemetry.schemas.ts` |
| Mappers | — |

## Autorización

Roles que alcanzan este módulo: `customer`, `internal_operator`, `risk_analyst`, `admin`, `platform_admin`.


## Pruebas

3 archivo(s) de test:

- `test/unit/customer-telemetry/customer-telemetry.controller.spec.ts`
- `test/unit/customer-telemetry/customer-telemetry.repository.spec.ts`
- `test/unit/customer-telemetry/customer-telemetry.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/customer-telemetry/customer-telemetry.module.ts`](../../../../src/modules/customer-telemetry/customer-telemetry.module.ts)
- Controller `CustomerTelemetryController`: [`src/modules/customer-telemetry/customer-telemetry.controller.ts`](../../../../src/modules/customer-telemetry/customer-telemetry.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
