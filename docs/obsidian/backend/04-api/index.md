---
title: "API — índice"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - api
aliases: []
related: []
---
# API — índice

**266 rutas** REST bajo `/api/v1` (salvo `/metrics`), repartidas en 48 clases controller y 35 etiquetas.

## Transversales

| Nota | Contenido |
|---|---|
| [[04-api/conventions]] | Prefijo, envoltura de respuesta, cabeceras, validación, límites de cuerpo |
| [[04-api/authentication]] | Cómo se autentica un request |
| [[04-api/authorization]] | Cómo se autoriza |
| [[04-api/error-model]] | Cómo se traduce cualquier excepción a HTTP |
| [[04-api/pagination-filtering-sorting]] | Paginación por cursor |
| [[04-api/rate-limits]] | Límites y su almacén compartido |
| [[04-api/versioning]] | Estrategia de versión |

## Por etiqueta

Ver el catálogo completo en [[15-reference/endpoint-catalog]]. Cada etiqueta tiene su nota en `04-api/rest/`.

| Grupo | Etiquetas |
|---|---|
| Identidad | [[04-api/rest/auth\|auth]], [[04-api/rest/sessions\|sessions]], [[04-api/rest/internal-auth\|internal-auth]], [[04-api/rest/internal-users\|internal-users]], [[04-api/rest/internal-access-catalog\|internal-access-catalog]] |
| Cliente | [[04-api/rest/customers\|customers]], [[04-api/rest/customer-onboarding\|customer-onboarding]], [[04-api/rest/customer-privacy\|customer-privacy]], [[04-api/rest/customer-telemetry\|customer-telemetry]], [[04-api/rest/customer-eligibility\|customer-eligibility]], [[04-api/rest/consents\|consents]] |
| Decisión | [[04-api/rest/risk\|risk]], [[04-api/rest/credit\|credit]], [[04-api/rest/external-data\|external-data]], [[04-api/rest/kyc\|kyc]], [[04-api/rest/bureau\|bureau]], [[04-api/rest/telco\|telco]], [[04-api/rest/social\|social]], [[04-api/rest/digital-trust\|digital-trust]], [[04-api/rest/payments-external\|payments-external]], [[04-api/rest/whatsapp\|whatsapp]] |
| Operación | [[04-api/rest/operations\|operations]], [[04-api/rest/internal-portal\|internal-portal]], [[04-api/rest/internal-admin-views\|internal-admin-views]], [[04-api/rest/runtime-jobs\|runtime-jobs]], [[04-api/rest/events\|events]], [[04-api/rest/audit\|audit]], [[04-api/rest/workflow-catalog\|workflow-catalog]] |
| Datos | [[04-api/rest/catalog-management\|catalog-management]], [[04-api/rest/data-quality\|data-quality]], [[04-api/rest/schema-management\|schema-management]] |
| Infra | [[04-api/rest/health\|health]], [[04-api/rest/notifications\|notifications]], [[04-api/rest/systems-ops\|systems-ops]], [[04-api/rest/metrics\|metrics]] |

> [!info] Dos etiquetas que no se ven en su controller
> **`systems-ops`** (46 rutas) recibe su `@ApiTags`, guards y roles del decorador compuesto `@SystemsOpsControllerSecurity()`, no del archivo del controller. Están protegidas aunque no lo parezca al leerlas.
>
> **`/metrics`** queda fuera del prefijo `/api/v1` y del contrato OpenAPI, a propósito.

## Contrato publicado

`docs/endpoints/openapi.yaml` — 253 rutas, 265 operaciones. Se genera con `yarn docs:openapi` y se valida con `yarn check:openapi` + `yarn docs:openapi:lint`.

El contrato **no se escribe a mano**: sale de los decoradores `@Api*` y de los esquemas Zod vía `zodToApiSchema()`. Validación y documentación son el mismo objeto.

## Relaciones

- [[15-reference/endpoint-catalog]] · [[15-reference/permissions-matrix]] · [[03-domains/index]]
