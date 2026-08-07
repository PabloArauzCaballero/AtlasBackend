---
title: "API — customer-onboarding"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "api"
  - "rest"
  - "tag/customer-onboarding"
source_files:
  - "src/modules/customer-onboarding/customer-onboarding-profile.controller.ts"
  - "src/modules/customer-onboarding/customer-onboarding-status.controller.ts"
  - "src/modules/customer-onboarding/customer-onboarding.controller.ts"
  - "src/modules/customer-onboarding/customer-verification.controller.ts"
endpoints:
  - "PATCH /customer-onboarding/:customerId/profile"
  - "PUT /customer-onboarding/:customerId/financial-profile"
  - "GET /customer-onboarding/:customerId/reference-contacts"
  - "POST /customer-onboarding/:customerId/reference-contacts"
  - "DELETE /customer-onboarding/:customerId/reference-contacts/:referenceId"
  - "POST /customer-onboarding/:customerId/contact-methods"
  - "POST /customer-onboarding/:customerId/documents/upload-url"
  - "POST /customer-onboarding/:customerId/identity-verification"
  - "GET /customer-onboarding/:customerId/status"
  - "POST /customer-onboarding/:customerId/submit"
  - "GET /customer-onboarding/:customerId/observations"
  - "POST /customer-onboarding/jobs/mark-abandoned"
  - "POST /customer-onboarding/start"
  - "POST /customer-onboarding/:customerId/contact-verification/request"
  - "POST /customer-onboarding/:customerId/contact-verification/submit"
  - "POST /customer-onboarding/:customerId/identity-package"
  - "POST /customer-onboarding/:customerId/address-package"
  - "POST /operations/customers/:customerId/identity-verification/decision"
  - "POST /operations/customers/:customerId/compliance/screening"
  - "POST /operations/customers/:customerId/compliance/clear-matches"
---
# API — `customer-onboarding`

20 endpoint(s), de los cuales **1 son públicos** (sin JWT).

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 4 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `PATCH` | `/customer-onboarding/:customerId/profile` | 🔒 JWT | `...CUSTOMER_AND_INTERNAL` | — | 200, 422 | Actualizar datos personales (guardado parcial) |
| `PUT` | `/customer-onboarding/:customerId/financial-profile` | 🔒 JWT | `...CUSTOMER_AND_INTERNAL` | — | 200, 422 | Registrar información laboral y económica (guardado parcial) |
| `GET` | `/customer-onboarding/:customerId/reference-contacts` | 🔒 JWT | `...CUSTOMER_AND_INTERNAL` | — | 200 | Listar referencias personales |
| `POST` | `/customer-onboarding/:customerId/reference-contacts` | 🔒 JWT | `...CUSTOMER_AND_INTERNAL` | — | 201, 409, 422 | Registrar referencias personales |
| `DELETE` | `/customer-onboarding/:customerId/reference-contacts/:referenceId` | 🔒 JWT | `...CUSTOMER_AND_INTERNAL` | — | 200, 404 | Quitar una referencia personal |
| `POST` | `/customer-onboarding/:customerId/contact-methods` | 🔒 JWT | `...CUSTOMER_AND_INTERNAL` | — | 201, 409 | Agregar o corregir un método de contacto |
| `POST` | `/customer-onboarding/:customerId/documents/upload-url` | 🔒 JWT | `...CUSTOMER_AND_INTERNAL` | — | 201, 422, 503 | Solicitar una URL de subida de documento |
| `POST` | `/customer-onboarding/:customerId/identity-verification` | 🔒 JWT | `...CUSTOMER_AND_INTERNAL` | — | 200, 422 | Verificar la identidad contra el registro externo |
| `GET` | `/customer-onboarding/:customerId/status` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200, 403, 404 | Estado y avance del onboarding |
| `POST` | `/customer-onboarding/:customerId/submit` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200, 422 | Enviar el paquete de onboarding a revisión |
| `GET` | `/customer-onboarding/:customerId/observations` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Observaciones abiertas del cliente |
| `POST` | `/customer-onboarding/jobs/mark-abandoned` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200 | Marcar como abandonados los onboardings inactivos (job) |
| `POST` | `/customer-onboarding/start` | 🔓 Público | — | `{ default: { ttl: 60_000, limit: 10 } }` | 201, 400, 409, 422 | Iniciar onboarding de un cliente nuevo |
| `POST` | `/customer-onboarding/:customerId/contact-verification/request` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 202, 403, 404, 409, 422 | Solicitar código de verificación de contacto (OTP) |
| `POST` | `/customer-onboarding/:customerId/contact-verification/submit` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200, 401, 403, 404, 409 | Confirmar código de verificación de contacto (OTP) |
| `POST` | `/customer-onboarding/:customerId/identity-package` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 202, 403, 404, 422 | Enviar paquete de identidad (documentos + selfie) |
| `POST` | `/customer-onboarding/:customerId/address-package` | 🔒 JWT | `customer`<br>`internal_operator`<br>`risk_analyst`<br>`admin`<br>`platform_admin` | — | 200, 403, 404, 422 | Enviar paquete de dirección |
| `POST` | `/operations/customers/:customerId/identity-verification/decision` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`admin`<br>`platform_admin` | — | 200, 404 | Resolver la verificación de identidad del cliente |
| `POST` | `/operations/customers/:customerId/compliance/screening` | 🔒 JWT | `compliance_analyst`<br>`risk_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Ejecutar el screening de listas restrictivas |
| `POST` | `/operations/customers/:customerId/compliance/clear-matches` | 🔒 JWT | `compliance_analyst`<br>`admin`<br>`platform_admin` | — | 200 | Descartar las coincidencias de listas restrictivas |

> [!danger] Superficie pública
> Estos endpoints no exigen JWT y son alcanzables por cualquiera que llegue al servicio: `POST /customer-onboarding/start`. Su protección depende del rate limiting y de la validación Zod. Ver [[08-security/threat-model]].

## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/customer-onboarding/customer-onboarding-profile.controller.ts`](../../../../../src/modules/customer-onboarding/customer-onboarding-profile.controller.ts)
- [`src/modules/customer-onboarding/customer-onboarding-status.controller.ts`](../../../../../src/modules/customer-onboarding/customer-onboarding-status.controller.ts)
- [`src/modules/customer-onboarding/customer-onboarding.controller.ts`](../../../../../src/modules/customer-onboarding/customer-onboarding.controller.ts)
- [`src/modules/customer-onboarding/customer-verification.controller.ts`](../../../../../src/modules/customer-onboarding/customer-verification.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
