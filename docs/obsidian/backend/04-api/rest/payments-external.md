---
title: "API — payments-external"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/payments-external"
source_files:
  - "src/modules/external-data/controllers/payments-telco.controller.ts"
endpoints:
  - "POST /payments/qr/verify"
  - "POST /payments/bank-transfer/verify"
  - "POST /payments/bank-transfer/qr"
---
# API — `payments-external`

3 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `POST` | `/payments/qr/verify` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Verificar pago por QR |
| `POST` | `/payments/bank-transfer/verify` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Verificar transferencia bancaria |
| `POST` | `/payments/bank-transfer/qr` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Generar QR de cobro bancario |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/external-data/controllers/payments-telco.controller.ts`](../../../../src/modules/external-data/controllers/payments-telco.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
