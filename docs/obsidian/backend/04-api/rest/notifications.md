---
title: "API — notifications"
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
  - "tag/notifications"
source_files:
  - "src/modules/notifications/notifications.controller.ts"
endpoints:
  - "GET /operations/notifications/messages"
  - "GET /operations/notifications/messages/:messageId"
  - "POST /operations/notifications/messages/:messageId/retry"
  - "POST /operations/notifications/messages/:messageId/cancel"
  - "GET /operations/notifications/templates"
  - "POST /operations/notifications/templates"
  - "PATCH /operations/notifications/templates/:templateId"
  - "GET /operations/notifications/preferences/:customerId"
  - "PATCH /operations/notifications/preferences/:customerId"
  - "POST /operations/notifications/broadcast"
  - "GET /customers/:customerId/notifications"
  - "GET /customers/:customerId/notifications/unread-count"
  - "POST /customers/:customerId/notifications/:notificationId/read"
  - "POST /customers/:customerId/notifications/read-all"
  - "POST /customers/:customerId/device-tokens"
  - "DELETE /customers/:customerId/device-tokens/:deviceTokenId"
  - "GET /internal-users/me/notifications"
  - "GET /internal-users/me/notifications/unread-count"
  - "POST /internal-users/me/notifications/:notificationId/read"
  - "POST /internal-users/me/notifications/read-all"
---
# API — `notifications`

20 endpoint(s), todos autenticados.

> [!info] Verificado
> Rutas extraídas de los decoradores `@Controller`/`@Get`/`@Post`… de 1 archivo(s). Todas las rutas cuelgan del prefijo global `${API_PREFIX}` (por defecto `api/v1`), salvo `/metrics`.

## Endpoints

| Método | Ruta | Auth | Roles | Rate limit | Códigos | Propósito |
|---|---|---|---|---|---|---|
| `GET` | `/operations/notifications/messages` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Listar mensajes de notificación (operaciones) |
| `GET` | `/operations/notifications/messages/:messageId` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 404 | Detalle de un mensaje de notificación (operaciones) |
| `POST` | `/operations/notifications/messages/:messageId/retry` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system`<br>`internal_operator` | — | 200, 400, 404 | Reintentar entrega de un mensaje fallido |
| `POST` | `/operations/notifications/messages/:messageId/cancel` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system`<br>`internal_operator` | — | 200, 400, 404 | Cancelar un mensaje de notificación pendiente |
| `GET` | `/operations/notifications/templates` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Listar plantillas de notificación |
| `POST` | `/operations/notifications/templates` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 201, 400 | Crear plantilla de notificación |
| `PATCH` | `/operations/notifications/templates/:templateId` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 200, 404 | Editar plantilla de notificación |
| `GET` | `/operations/notifications/preferences/:customerId` | 🔒 JWT | `internal_operator`<br>`risk_analyst`<br>`compliance_analyst`<br>`fraud_analyst`<br>`admin`<br>`platform_admin`<br>`system` | — | 200 | Preferencias de notificación de un cliente (operaciones) |
| `PATCH` | `/operations/notifications/preferences/:customerId` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system`<br>`internal_operator` | — | 200, 400 | Editar preferencias de notificación de un cliente (operaciones) |
| `POST` | `/operations/notifications/broadcast` | 🔒 JWT | `admin`<br>`platform_admin`<br>`system` | — | 202, 400 | Enviar notificación in-app personalizada (broadcast de admin) |
| `GET` | `/customers/:customerId/notifications` | 🔒 JWT | `customer`<br>`internal_operator`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 403 | Listar notificaciones del cliente (autoservicio) |
| `GET` | `/customers/:customerId/notifications/unread-count` | 🔒 JWT | `customer`<br>`internal_operator`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 403 | Contador de notificaciones no leídas del cliente |
| `POST` | `/customers/:customerId/notifications/:notificationId/read` | 🔒 JWT | `customer`<br>`internal_operator`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 403, 404 | Marcar una notificación como leída |
| `POST` | `/customers/:customerId/notifications/read-all` | 🔒 JWT | `customer`<br>`internal_operator`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 403 | Marcar todas las notificaciones del cliente como leídas |
| `POST` | `/customers/:customerId/device-tokens` | 🔒 JWT | `customer`<br>`internal_operator`<br>`admin`<br>`platform_admin`<br>`system` | — | 201, 403 | Registrar/actualizar token de dispositivo (push) |
| `DELETE` | `/customers/:customerId/device-tokens/:deviceTokenId` | 🔒 JWT | `customer`<br>`internal_operator`<br>`admin`<br>`platform_admin`<br>`system` | — | 200, 403, 404 | Desactivar token de dispositivo (push) |
| `GET` | `/internal-users/me/notifications` | 🔒 JWT | `...INTERNAL_SELF_SERVICE_ROLES` | — | 200, 403 | Listar mis notificaciones (usuario interno, autoservicio) |
| `GET` | `/internal-users/me/notifications/unread-count` | 🔒 JWT | `...INTERNAL_SELF_SERVICE_ROLES` | — | 200, 403 | Contador de mis notificaciones no leídas (usuario interno) |
| `POST` | `/internal-users/me/notifications/:notificationId/read` | 🔒 JWT | `...INTERNAL_SELF_SERVICE_ROLES` | — | 200, 403, 404 | Marcar una de mis notificaciones como leída (usuario interno) |
| `POST` | `/internal-users/me/notifications/read-all` | 🔒 JWT | `...INTERNAL_SELF_SERVICE_ROLES` | — | 200, 403 | Marcar todas mis notificaciones como leídas (usuario interno) |



## Contrato

- Convenciones comunes (envoltura de respuesta, correlación, paginación): [[04-api/conventions]]
- Modelo de error: [[04-api/error-model]]
- Autenticación: [[04-api/authentication]] · Autorización: [[04-api/authorization]]
- Contrato OpenAPI generado: [`docs/endpoints/openapi.yaml`](../../../../endpoints/openapi.yaml)

## Evidencia

- [`src/modules/notifications/notifications.controller.ts`](../../../../../src/modules/notifications/notifications.controller.ts)

## Relaciones

- Catálogo global: [[15-reference/endpoint-catalog]]
- Índice de API: [[04-api/index]]
