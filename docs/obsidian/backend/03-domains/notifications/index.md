---
title: "notifications"
type: "domain"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "notifications"
module: "NotificationsModule"
tags:
  - "backend"
  - "domain"
  - "module/notifications"
source_files:
  - "src/modules/notifications/notifications.module.ts"
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
dependencies:
  - "CustomersModule"
  - "InternalUsersModule"
---
# Módulo `notifications`

Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.

**Papel técnico:** orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

| | |
|---|---|
| Clase | `NotificationsModule` |
| Archivos | 22 |
| Controllers | 1 |
| Rutas HTTP | 20 |
| Modelos usados | 7 |
| Esquemas de datos | [[customer-schema\|customer]], [[messaging-schema\|messaging]], [[iam-schema\|iam]] |

## Entradas

20 rutas HTTP. Contrato completo en [[04-api/rest/notifications\|notifications]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/operations/notifications/messages` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `GET` | `/operations/notifications/messages/:messageId` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/notifications/messages/:messageId/retry` | 🔒 | `admin` `platform_admin` `system` `internal_operator` |
| `POST` | `/operations/notifications/messages/:messageId/cancel` | 🔒 | `admin` `platform_admin` `system` `internal_operator` |
| `GET` | `/operations/notifications/templates` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `POST` | `/operations/notifications/templates` | 🔒 | `admin` `platform_admin` `system` |
| `PATCH` | `/operations/notifications/templates/:templateId` | 🔒 | `admin` `platform_admin` `system` |
| `GET` | `/operations/notifications/preferences/:customerId` | 🔒 | `internal_operator` `risk_analyst` `compliance_analyst` `fraud_analyst` |
| `PATCH` | `/operations/notifications/preferences/:customerId` | 🔒 | `admin` `platform_admin` `system` `internal_operator` |
| `POST` | `/operations/notifications/broadcast` | 🔒 | `admin` `platform_admin` `system` |
| `GET` | `/customers/:customerId/notifications` | 🔒 | `customer` `internal_operator` `admin` `platform_admin` |
| `GET` | `/customers/:customerId/notifications/unread-count` | 🔒 | `customer` `internal_operator` `admin` `platform_admin` |
| `POST` | `/customers/:customerId/notifications/:notificationId/read` | 🔒 | `customer` `internal_operator` `admin` `platform_admin` |
| `POST` | `/customers/:customerId/notifications/read-all` | 🔒 | `customer` `internal_operator` `admin` `platform_admin` |
| `POST` | `/customers/:customerId/device-tokens` | 🔒 | `customer` `internal_operator` `admin` `platform_admin` |
| `DELETE` | `/customers/:customerId/device-tokens/:deviceTokenId` | 🔒 | `customer` `internal_operator` `admin` `platform_admin` |
| `GET` | `/internal-users/me/notifications` | 🔒 | `...INTERNAL_SELF_SERVICE_ROLES` |
| `GET` | `/internal-users/me/notifications/unread-count` | 🔒 | `...INTERNAL_SELF_SERVICE_ROLES` |
| `POST` | `/internal-users/me/notifications/:notificationId/read` | 🔒 | `...INTERNAL_SELF_SERVICE_ROLES` |
| `POST` | `/internal-users/me/notifications/read-all` | 🔒 | `...INTERNAL_SELF_SERVICE_ROLES` |

## Salidas y efectos

Persiste en 7 tabla(s):

- [[customer_contact_methods]] (`customer`)
- [[device_tokens]] (`messaging`)
- [[notification_deliveries]] (`messaging`)
- [[notification_messages]] (`messaging`)
- [[notification_templates]] (`messaging`)
- [[tenants]] (`iam`)
- [[user_notification_preferences]] (`messaging`)

## Dependencias

**Depende de:** [[03-domains/customers/index\|customers]], [[03-domains/internal-users/index\|internal-users]]

**Del que dependen:** [[03-domains/customer-onboarding/index\|customer-onboarding]], [[03-domains/events/index\|events]], [[03-domains/runtime-jobs/index\|runtime-jobs]], [[03-domains/systems-ops/index\|systems-ops]]

**Exporta:** `NotificationOrchestratorService`, `NotificationsService`, `NotificationsRepository`, `NotificationBroadcastService`, `SmsNotificationAdapter`, `WhatsAppNotificationAdapter`

> [!warning] Exporta un repositorio
> Otros módulos pueden llegar a la persistencia de este dominio sin pasar por su servicio, saltándose las reglas que vivan ahí. La regla del proyecto solo lo admite con necesidad transaccional real y documentada.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `notifications.controller.ts` |
| Services | `notification-broadcast.service.ts`, `notification-orchestrator.service.ts`, `notification-rules.service.ts`, `notification-template-renderer.service.ts`, `notifications.service.ts`, `adapters/notification-provider-config.service.ts` |
| Repositories | `notification-preferences.repository.ts`, `notification-templates.repository.ts`, `notifications.repository.ts` |
| Esquemas Zod | `notifications.schemas.ts` |
| Mappers | `notifications.mapper.ts` |

## Autorización

Roles que alcanzan este módulo: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`, `customer`, `...INTERNAL_SELF_SERVICE_ROLES`.


## Pruebas

21 archivo(s) de test:

- `test/e2e/notifications/internal-user-notifications.spec.ts`
- `test/e2e/notifications/notification-broadcast.spec.ts`
- `test/unit/notifications/email.adapter.spec.ts`
- `test/unit/notifications/in-app-notification.adapter.spec.ts`
- `test/unit/notifications/notification-broadcast.deferred.spec.ts`
- `test/unit/notifications/notification-broadcast.service.spec.ts`
- `test/unit/notifications/notification-orchestrator.service.spec.ts`
- `test/unit/notifications/notification-preferences.repository.spec.ts`
- `test/unit/notifications/notification-provider-config.service.spec.ts`
- `test/unit/notifications/notification-rules.service.spec.ts`
- `test/unit/notifications/notification-template-renderer.service.spec.ts`
- `test/unit/notifications/notification-templates.repository.spec.ts`
- `test/unit/notifications/notifications-repository-recipient.spec.ts`
- `test/unit/notifications/notifications.controller.spec.ts`
- `test/unit/notifications/notifications.mapper.spec.ts`
- … y 6 más

## Referencias al código

- Módulo: [`src/modules/notifications/notifications.module.ts`](../../../../src/modules/notifications/notifications.module.ts)
- Controller `NotificationsController`: [`src/modules/notifications/notifications.controller.ts`](../../../../src/modules/notifications/notifications.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
