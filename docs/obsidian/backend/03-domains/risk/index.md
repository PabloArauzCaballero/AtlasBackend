---
title: "risk"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "risk"
module: "RiskModule"
tags:
  - "backend"
  - "domain"
  - "module/risk"
source_files:
  - "src/modules/risk/risk.module.ts"
  - "src/modules/risk/risk.controller.ts"
endpoints:
  - "POST /customers/:customerId/risk-assessments"
  - "GET /operations/risk-assessments/:riskAssessmentRunId"
  - "GET /operations/risk-assessments/:riskAssessmentRunId/explanation"
dependencies:
  - "CustomersModule"
---
# Módulo `risk`

Esta pieza produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.

**Papel técnico:** calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.

| | |
|---|---|
| Clase | `RiskModule` |
| Archivos | 14 |
| Controllers | 1 |
| Rutas HTTP | 3 |
| Modelos usados | 20 |
| Esquemas de datos | [[privacy-schema\|privacy]], [[customer-schema\|customer]], [[audit-schema\|audit]], [[risk-schema\|risk]], [[case_management-schema\|case_management]] |

## Entradas

3 rutas HTTP. Contrato completo en [[04-api/rest/risk\|risk]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `POST` | `/customers/:customerId/risk-assessments` | 🔒 | `customer` `internal_operator` `risk_analyst` `system` |
| `GET` | `/operations/risk-assessments/:riskAssessmentRunId` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `GET` | `/operations/risk-assessments/:riskAssessmentRunId/explanation` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |

## Salidas y efectos

Persiste en 20 tabla(s):

- [[customer_consents]] (`privacy`)
- [[customer_contact_methods]] (`customer`)
- [[customer_identity_documents]] (`customer`)
- [[data_change_logs]] (`audit`)
- [[data_quality_issues]] (`audit`)
- [[feature_computation_runs]] (`risk`)
- [[feature_lineage_links]] (`risk`)
- [[feature_snapshots]] (`risk`)
- [[feature_values]] (`risk`)
- [[fraud_cases]] (`case_management`)
- [[manual_review_cases]] (`case_management`)
- [[operational_audit_logs]] (`audit`)
- [[risk_assessment_contexts]] (`risk`)
- [[risk_assessment_results]] (`risk`)
- [[risk_assessment_runs]] (`risk`)
- [[risk_feature_contributions]] (`risk`)
- [[risk_policy_rules]] (`risk`)
- [[risk_rules_fired]] (`risk`)
- [[risk_ruleset_versions]] (`risk`)
- [[watchlist_matches]] (`case_management`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]]

**Del que dependen:** [[03-domains/operations/index\|operations]]

**Exporta:** `RiskRepository`, `RiskService`

> [!warning] Exporta un repositorio
> Otros módulos pueden llegar a la persistencia de este dominio sin pasar por su servicio, saltándose las reglas que vivan ahí. La regla del proyecto solo lo admite con necesidad transaccional real y documentada.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `risk.controller.ts` |
| Services | `risk.service.ts`, `application/risk-policy-decision.service.ts` |
| Repositories | `risk.repository.ts`, `repositories/risk-policy.repository.ts` |
| Esquemas Zod | `risk.schemas.ts` |
| Mappers | `risk.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `customer`, `internal_operator`, `risk_analyst`, `system`, `admin`, `platform_admin`, `compliance_analyst`, `fraud_analyst`.


## Pruebas

9 archivo(s) de test:

- `test/unit/catalog-management/catalog-risk-policy.repository.spec.ts`
- `test/unit/catalog-management/catalog-risk-policy.service.spec.ts`
- `test/unit/risk/risk-policy-decision.service.spec.ts`
- `test/unit/risk/risk-policy.repository.spec.ts`
- `test/unit/risk/risk-ruleset-evaluator.spec.ts`
- `test/unit/risk/risk.controller.spec.ts`
- `test/unit/risk/risk.mapper.spec.ts`
- `test/unit/risk/risk.repository.spec.ts`
- `test/unit/risk/risk.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/risk/risk.module.ts`](../../../../src/modules/risk/risk.module.ts)
- Controller `RiskController`: [`src/modules/risk/risk.controller.ts`](../../../../src/modules/risk/risk.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
