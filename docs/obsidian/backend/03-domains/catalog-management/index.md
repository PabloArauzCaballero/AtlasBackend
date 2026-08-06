---
title: "catalog-management"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "catalog-management"
module: "CatalogManagementModule"
tags:
  - "backend"
  - "domain"
  - "module/catalog-management"
source_files:
  - "src/modules/catalog-management/catalog-management.module.ts"
  - "src/modules/catalog-management/catalog-management.controller.ts"
endpoints:
  - "GET /operations/catalogs"
  - "GET /operations/catalogs/:catalogCode/versions/:versionId"
  - "POST /operations/catalogs/:catalogCode/versions"
  - "POST /operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval"
  - "POST /operations/catalogs/:catalogCode/versions/:versionId/decision"
  - "POST /operations/catalog-ingestions"
  - "POST /operations/catalog-staging-items/decision-batch"
  - "GET /operations/definitions"
  - "POST /operations/definitions/package"
  - "GET /operations/risk-policy/current"
  - "POST /operations/risk-policy/ruleset-versions"
  - "POST /operations/risk-policy/ruleset-versions/:rulesetVersionId/activate"
  - "GET /operations/data-governance/policies"
  - "POST /operations/data-governance/policy-package"
dependencies: []
---
# Módulo `catalog-management`

Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.

**Papel técnico:** implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.

| | |
|---|---|
| Clase | `CatalogManagementModule` |
| Archivos | 18 |
| Controllers | 1 |
| Rutas HTTP | 14 |
| Modelos usados | 25 |
| Esquemas de datos | [[catalog-schema\|catalog]], [[audit-schema\|audit]], [[privacy-schema\|privacy]], [[integrations-schema\|integrations]], [[risk-schema\|risk]] |

## Entradas

14 rutas HTTP. Contrato completo en [[04-api/rest/catalog-management\|catalog-management]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/operations/catalogs` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `GET` | `/operations/catalogs/:catalogCode/versions/:versionId` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/catalogs/:catalogCode/versions` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/catalogs/:catalogCode/versions/:versionId/decision` | 🔒 | `admin` `platform_admin` |
| `POST` | `/operations/catalog-ingestions` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/catalog-staging-items/decision-batch` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `GET` | `/operations/definitions` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/definitions/package` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `GET` | `/operations/risk-policy/current` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/risk-policy/ruleset-versions` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/risk-policy/ruleset-versions/:rulesetVersionId/activate` | 🔒 | `admin` `platform_admin` |
| `GET` | `/operations/data-governance/policies` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/data-governance/policy-package` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |

## Salidas y efectos

Persiste en 25 tabla(s):

- [[attribute_definitions]] (`catalog`)
- [[context_approval_events]] (`catalog`)
- [[context_catalogs]] (`catalog`)
- [[context_catalog_versions]] (`catalog`)
- [[context_ingestion_jobs]] (`catalog`)
- [[context_item_aliases]] (`catalog`)
- [[context_items]] (`catalog`)
- [[context_risk_mappings]] (`catalog`)
- [[context_sources]] (`catalog`)
- [[context_staging_items]] (`catalog`)
- [[data_change_logs]] (`audit`)
- [[data_classification_policies]] (`privacy`)
- [[data_providers]] (`integrations`)
- [[data_quality_rules]] (`audit`)
- [[event_definitions]] (`catalog`)
- [[feature_definitions]] (`risk`)
- [[observation_definitions]] (`catalog`)
- [[operational_audit_logs]] (`audit`)
- [[privacy_processing_purposes]] (`privacy`)
- [[retention_policies]] (`privacy`)
- [[risk_model_versions]] (`risk`)
- [[risk_policy_rules]] (`risk`)
- [[risk_ruleset_versions]] (`risk`)
- [[risk_signal_seeds]] (`risk`)
- [[sensitive_field_rules]] (`privacy`)

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `catalog-management.controller.ts` |
| Services | `catalog-management.service.ts`, `application/catalog-data-governance.service.ts`, `application/catalog-definitions.service.ts`, `application/catalog-ingestion.service.ts`, `application/catalog-query.service.ts`, `application/catalog-risk-policy.service.ts`, `application/catalog-version-workflow.service.ts` |
| Repositories | `catalog-data-governance.repository.ts`, `catalog-definitions.repository.ts`, `catalog-management.repository.ts`, `catalog-risk-policy.repository.ts` |
| Esquemas Zod | `catalog-management.schemas.ts` |
| Mappers | `catalog-management.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`.


## Pruebas

15 archivo(s) de test:

- `test/e2e/catalog-management/context-ingestion.spec.ts`
- `test/unit/catalog-management/catalog-data-governance.repository.spec.ts`
- `test/unit/catalog-management/catalog-data-governance.service.spec.ts`
- `test/unit/catalog-management/catalog-definitions.repository.spec.ts`
- `test/unit/catalog-management/catalog-definitions.service.spec.ts`
- `test/unit/catalog-management/catalog-ingestion.service.spec.ts`
- `test/unit/catalog-management/catalog-management.controller.spec.ts`
- `test/unit/catalog-management/catalog-management.mapper.spec.ts`
- `test/unit/catalog-management/catalog-management.repository.spec.ts`
- `test/unit/catalog-management/catalog-management.service.spec.ts`
- `test/unit/catalog-management/catalog-query.service.spec.ts`
- `test/unit/catalog-management/catalog-risk-policy.repository.spec.ts`
- `test/unit/catalog-management/catalog-risk-policy.service.spec.ts`
- `test/unit/catalog-management/catalog-version-workflow.service.spec.ts`
- `test/unit/openapi/catalog-management-openapi.spec.ts`

## Referencias al código

- Módulo: [`src/modules/catalog-management/catalog-management.module.ts`](../../../../src/modules/catalog-management/catalog-management.module.ts)
- Controller `CatalogManagementController`: [`src/modules/catalog-management/catalog-management.controller.ts`](../../../../src/modules/catalog-management/catalog-management.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
