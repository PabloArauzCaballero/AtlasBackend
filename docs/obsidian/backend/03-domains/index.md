---
title: "Dominios y módulos"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
tags:
  - "backend"
  - "domain"
  - "index"
---
# Dominios y módulos

**27 módulos de negocio** en `src/modules/`, más los módulos de infraestructura declarados en `AppModule`.

## Índice

| Módulo | Rutas | Modelos | Depende de | Lo importan |
|---|---:|---:|---|---:|
| [[03-domains/audit/index\|audit]] | 2 | 13 | 0 | 0 |
| [[03-domains/auth/index\|auth]] | 9 | 7 | 2 | 2 |
| [[03-domains/catalog-management/index\|catalog-management]] | 14 | 25 | 0 | 0 |
| [[03-domains/consents/index\|consents]] | 1 | 3 | 1 | 2 |
| [[03-domains/credit/index\|credit]] | 8 | 3 | 1 | 0 |
| [[03-domains/customer-onboarding/index\|customer-onboarding]] | 20 | 27 | 7 | 0 |
| [[03-domains/customer-privacy/index\|customer-privacy]] | 2 | 6 | 2 | 0 |
| [[03-domains/customer-telemetry/index\|customer-telemetry]] | 1 | 17 | 1 | 0 |
| [[03-domains/customers/index\|customers]] | 3 | 23 | 0 | 12 |
| [[03-domains/data-quality/index\|data-quality]] | 2 | 4 | 0 | 0 |
| [[03-domains/events/index\|events]] | 6 | 1 | 1 | 1 |
| [[03-domains/external-data/index\|external-data]] | 45 | 8 | 0 | 1 |
| [[03-domains/fraud/index\|fraud]] | 0 | 7 | 1 | 1 |
| [[03-domains/health/index\|health]] | 3 | 0 | 0 | 0 |
| [[03-domains/internal-portal/index\|internal-portal]] | 31 | 0 | 0 | 0 |
| [[03-domains/internal-users/index\|internal-users]] | 13 | 7 | 1 | 1 |
| [[03-domains/log-sync/index\|log-sync]] | 1 | 0 | 0 | 0 |
| [[03-domains/mail-sender/index\|mail-sender]] | 0 | 0 | 1 | 2 |
| [[03-domains/notifications/index\|notifications]] | 20 | 7 | 2 | 4 |
| [[03-domains/operations/index\|operations]] | 6 | 7 | 3 | 0 |
| [[03-domains/risk/index\|risk]] | 3 | 20 | 1 | 1 |
| [[03-domains/runtime-hardening/index\|runtime-hardening]] | 0 | 2 | 0 | 0 |
| [[03-domains/runtime-jobs/index\|runtime-jobs]] | 9 | 11 | 2 | 0 |
| [[03-domains/schema-management/index\|schema-management]] | 7 | 0 | 0 | 0 |
| [[03-domains/sessions/index\|sessions]] | 5 | 19 | 1 | 1 |
| [[03-domains/systems-ops/index\|systems-ops]] | 45 | 18 | 1 | 0 |
| [[03-domains/workflow-catalog/index\|workflow-catalog]] | 9 | 6 | 2 | 0 |

## Agrupación funcional

| Grupo | Módulos |
|---|---|
| Identidad y acceso | [[03-domains/auth/index\|auth]], [[03-domains/internal-users/index\|internal-users]], [[03-domains/sessions/index\|sessions]] |
| Cliente y onboarding | [[03-domains/customers/index\|customers]], [[03-domains/customer-onboarding/index\|customer-onboarding]], [[03-domains/customer-privacy/index\|customer-privacy]], [[03-domains/customer-telemetry/index\|customer-telemetry]], [[03-domains/consents/index\|consents]] |
| Decisión de crédito | [[03-domains/risk/index\|risk]], [[03-domains/fraud/index\|fraud]], [[03-domains/credit/index\|credit]], [[03-domains/external-data/index\|external-data]] |
| Gobierno de datos | [[03-domains/catalog-management/index\|catalog-management]], [[03-domains/data-quality/index\|data-quality]], [[03-domains/schema-management/index\|schema-management]] |
| Comunicación | [[03-domains/notifications/index\|notifications]], [[03-domains/mail-sender/index\|mail-sender]] |
| Plataforma y operación | [[03-domains/events/index\|events]], [[03-domains/runtime-jobs/index\|runtime-jobs]], [[03-domains/runtime-hardening/index\|runtime-hardening]], [[03-domains/operations/index\|operations]], [[03-domains/systems-ops/index\|systems-ops]], [[03-domains/internal-portal/index\|internal-portal]], [[03-domains/workflow-catalog/index\|workflow-catalog]], [[03-domains/audit/index\|audit]], [[03-domains/log-sync/index\|log-sync]], [[03-domains/health/index\|health]] |

## Módulos hoja

Sin dependencias hacia otros módulos de negocio — los candidatos naturales a extracción:

- [[03-domains/audit/index\|audit]]
- [[03-domains/catalog-management/index\|catalog-management]]
- [[03-domains/customers/index\|customers]]
- [[03-domains/data-quality/index\|data-quality]]
- [[03-domains/external-data/index\|external-data]]
- [[03-domains/health/index\|health]]
- [[03-domains/internal-portal/index\|internal-portal]]
- [[03-domains/log-sync/index\|log-sync]]
- [[03-domains/runtime-hardening/index\|runtime-hardening]]
- [[03-domains/schema-management/index\|schema-management]]

## El núcleo compartido

- [[03-domains/customers/index\|customers]] — importado por 12 módulo(s)
- [[03-domains/notifications/index\|notifications]] — importado por 4 módulo(s)
- [[03-domains/mail-sender/index\|mail-sender]] — importado por 2 módulo(s)
- [[03-domains/consents/index\|consents]] — importado por 2 módulo(s)
- [[03-domains/auth/index\|auth]] — importado por 2 módulo(s)

## Relaciones

- [[02-architecture/dependency-map]] · [[02-architecture/module-boundaries]] · [[01-overview/repository-map]]
