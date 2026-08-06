---
title: "API — external-data"
type: "api"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/external-data"
source_files:
  - "src/modules/external-data/external-data.controller.ts"
endpoints:
  - "POST /external-data/consents"
  - "GET /external-data/consents/user/:customerId"
  - "POST /external-data/consents/:consentId/revoke"
  - "POST /external-data/requests/preview"
  - "POST /external-data/requests"
  - "GET /external-data/requests/:requestId"
  - "GET /external-data/providers/health"
  - "GET /external-data/users/:customerId/features"
  - "GET /external-data/users/:customerId/scoring-input"
  - "GET /external-data/users/:customerId/decision-package"
  - "GET /external-data/users/:customerId/observations"
---
# API — `external-data`

11 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/external-data/consents` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 201, 403 | Registrar consentimiento para un proveedor externo |
| `GET` | `/external-data/consents/user/:customerId` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Listar consentimientos de proveedores externos de un cliente |
| `POST` | `/external-data/consents/:consentId/revoke` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 404 | Revocar consentimiento de proveedor externo |
| `POST` | `/external-data/requests/preview` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Preflight de una solicitud a proveedor externo |
| `POST` | `/external-data/requests` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 403 | Ejecutar solicitud a proveedor externo |
| `GET` | `/external-data/requests/:requestId` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 404 | Detalle de una solicitud a proveedor externo |
| `GET` | `/external-data/providers/health` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Estado de salud de proveedores externos |
| `GET` | `/external-data/users/:customerId/features` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Features derivados de datos externos de un cliente |
| `GET` | `/external-data/users/:customerId/scoring-input` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Input de scoring de riesgo derivado de datos externos |
| `GET` | `/external-data/users/:customerId/decision-package` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Paquete de decisión completo de un cliente |
| `GET` | `/external-data/users/:customerId/observations` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Observaciones normalizadas de un cliente |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/external-data/external-data.controller.ts`](../../../../src/modules/external-data/external-data.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
