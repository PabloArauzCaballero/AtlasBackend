---
title: "API — consents"
type: "api"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/consents"
source_files:
  - "src/modules/consents/consents.controller.ts"
endpoints:
  - "GET /consent-documents/active"
---
# API — `consents`

1 endpoint(s), de los cuales **1 son públicos** (sin JWT).

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/consent-documents/active` | 🔓 Público | — | — | 200, 400 | Listar documentos de consentimiento activos |

> [!danger] Superficie pública
> Estos endpoints no exigen JWT y son alcanzables por cualquiera que llegue al servicio: `GET /consent-documents/active`. Su protección depende del rate limiting y de la validación Zod. Ver [[08-security/threat-model]].

## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/consents/consents.controller.ts`](../../../../src/modules/consents/consents.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
