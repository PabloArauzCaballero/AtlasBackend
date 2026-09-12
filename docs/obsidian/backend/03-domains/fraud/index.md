---
title: "fraud"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "fraud"
module: "FraudModule"
tags:
  - "backend"
  - "domain"
  - "module/fraud"
source_files:
  - "src/modules/fraud/fraud.module.ts"
endpoints: []
dependencies:
  - "CustomersModule"
---
# Módulo `fraud`

Esta pieza reduce pérdidas y habilita revisión humana explicable de señales sospechosas.

**Papel técnico:** administra casos, decisiones y eventos de fraude dentro de transacciones auditables.

| | |
|---|---|
| Clase | `FraudModule` |
| Archivos | 4 |
| Controllers | 0 |
| Rutas HTTP | 0 |
| Modelos usados | 7 |
| Esquemas de datos | [[catalog-schema\|catalog]], [[customer-schema\|customer]], [[audit-schema\|audit]], [[case_management-schema\|case_management]] |

## Entradas

`VERIFICADO` — el módulo **no expone rutas HTTP**. Se invoca desde otros módulos o desde el trabajo de fondo.

## Salidas y efectos

Persiste en 7 tabla(s):

- [[customer_observations]] (`catalog`)
- [[customer_status_events]] (`customer`)
- [[data_change_logs]] (`audit`)
- [[fraud_case_events]] (`case_management`)
- [[fraud_cases]] (`case_management`)
- [[operational_audit_logs]] (`audit`)
- [[watchlist_entries]] (`case_management`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]]

**Del que dependen:** [[03-domains/operations/index\|operations]]

**Exporta:** `FraudService`

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | — |
| Services | `fraud.service.ts` |
| Repositories | `fraud.repository.ts` |
| Esquemas Zod | `fraud.schemas.ts` |
| Mappers | — |

## Autorización

Sin rutas HTTP: no aplica autorización de transporte.


## Pruebas

2 archivo(s) de test:

- `test/unit/fraud/fraud.repository.spec.ts`
- `test/unit/fraud/fraud.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/fraud/fraud.module.ts`](../../../../../src/modules/fraud/fraud.module.ts)


## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
