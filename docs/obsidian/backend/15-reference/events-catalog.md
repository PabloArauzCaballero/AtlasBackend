---
title: "Catálogo de eventos"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - "backend"
  - "reference"
  - "events"
source_files:
  - "src/modules/events/event-registry.ts"
  - "src/modules/events/event-types.ts"
---
# Catálogo de eventos

**92 tipos de evento** en **9 familias**, declarados en [`src/modules/events/event-registry.ts`](../../../../src/modules/events/event-registry.ts).

Los eventos se publican mediante el patrón **outbox transaccional** (tabla `platform_ops.outbox_events`). Ver [[07-async-processing/events]] y [[02-architecture/adr/0001-outbox-en-postgresql|ADR-0001]].

Estados de un evento en el outbox: `pending` → `processing` → `processed` | `failed` | `cancelled` (`OutboxEventStatus`).

## Familia `user_security`

- **Prioridad:** por defecto
- **Tipos de agregado:** `customer`, `user`, `session`, `device`
- **Eventos (10):**

  - `user.registered`
  - `user.profile.completed`
  - `user.email.verified`
  - `user.phone.verified`
  - `user.login.succeeded`
  - `user.login.failed`
  - `user.device.registered`
  - `user.device.changed`
  - `user.account.locked`
  - `user.account.reactivated`

## Familia `kyc_legal`

- **Prioridad:** 10
- **Tipos de agregado:** `customer`, `kyc_case`, `consent`, `legal_document`
- **Eventos (10):**

  - `kyc.started`
  - `kyc.submitted`
  - `kyc.approved`
  - `kyc.rejected`
  - `kyc.requires_review`
  - `consent.accepted`
  - `consent.revoked`
  - `terms.accepted`
  - `privacy_policy.accepted`
  - `legal_document.generated`

## Familia `risk_scoring_fraud`

- **Prioridad:** 20
- **Tipos de agregado:** `customer`, `score`, `risk_alert`, `fraud_case`
- **Eventos (11):**

  - `score.requested`
  - `score.calculated`
  - `score.approved`
  - `score.rejected`
  - `score.manual_review_required`
  - `risk.signal.detected`
  - `risk.alert.created`
  - `risk.alert.resolved`
  - `fraud.rule.triggered`
  - `fraud.case.opened`
  - `fraud.case.closed`

## Familia `credit_line`

- **Prioridad:** 20
- **Tipos de agregado:** `customer`, `credit_line`, `credit_limit_movement`
- **Eventos (9):**

  - `credit_line.created`
  - `credit_line.approved`
  - `credit_line.rejected`
  - `credit_line.increased`
  - `credit_line.decreased`
  - `credit_line.suspended`
  - `credit_line.reactivated`
  - `credit_line.expired`
  - `credit_limit_movement.created`

## Familia `purchase_downpayment`

- **Prioridad:** 30
- **Tipos de agregado:** `purchase`, `customer`, `merchant`
- **Eventos (8):**

  - `purchase.created`
  - `purchase.awaiting_downpayment`
  - `purchase.downpayment_confirmed`
  - `purchase.downpayment_rejected`
  - `purchase.expired`
  - `purchase.cancelled`
  - `purchase.approved`
  - `purchase.completed`

## Familia `installments_collections`

- **Prioridad:** 40
- **Tipos de agregado:** `installment`, `collection_case`, `customer`, `purchase`
- **Eventos (14):**

  - `installment.schedule.created`
  - `installment.created`
  - `installment.due_soon`
  - `installment.due_today`
  - `installment.grace_period_started`
  - `installment.overdue`
  - `installment.paid`
  - `installment.partially_paid`
  - `installment.defaulted`
  - `collection.case.created`
  - `collection.reminder.scheduled`
  - `collection.reminder.sent`
  - `collection.promise_to_pay.created`
  - `collection.case.resolved`

## Familia `payments`

- **Prioridad:** 40
- **Tipos de agregado:** `payment`, `installment`, `purchase`, `customer`, `merchant`
- **Eventos (3):**

  - `payment.reported`
  - `payment.confirmed`
  - `payment.rejected`

## Familia `merchant_settlement`

- **Prioridad:** 20
- **Tipos de agregado:** `merchant`, `settlement`, `mdr_invoice`, `reconciliation`
- **Eventos (15):**

  - `merchant.registered`
  - `merchant.kyb.submitted`
  - `merchant.kyb.approved`
  - `merchant.kyb.rejected`
  - `merchant.sale.created`
  - `merchant.sale.confirmed`
  - `merchant.settlement.created`
  - `merchant.settlement.ready`
  - `merchant.settlement.paid`
  - `merchant.mdr.invoice.created`
  - `merchant.mdr.invoice.due`
  - `merchant.mdr.invoice.overdue`
  - `reconciliation.started`
  - `reconciliation.matched`
  - `reconciliation.unmatched`

## Familia `notifications`

- **Prioridad:** 10
- **Tipos de agregado:** `notification`, `template`, `customer`, `internal_user`
- **Eventos (12):**

  - `notification.requested`
  - `notification.created`
  - `notification.queued`
  - `notification.sent`
  - `notification.failed`
  - `notification.delivered`
  - `notification.read`
  - `notification.cancelled`
  - `notification.preference.updated`
  - `template.created`
  - `template.updated`
  - `template.disabled`


## Contradicción: eventos sin persistencia

> [!warning] Eventos declarados para dominios que aún no existen en el esquema
> Varias familias declaran agregados que **no tienen tabla** en el modelo físico: `merchant`, `settlement`, `installment`, `purchase`, `payment`, `collection_case`, `credit_line`, `mdr_invoice`.
>
> Las familias `purchase_downpayment` (8), `installments_collections` (14), `payments` (3) y `merchant_settlement` (15) — **40 de los 92 eventos** — describen un ciclo de vida de compra/cuotas/liquidación que el esquema actual (130 tablas) no soporta: solo existen `credit_products`, `credit_applications` y `credit_application_events`.
>
> Lectura: el registro de eventos es un **contrato hacia adelante** (roadmap), no un reflejo de lo implementado. Un consumidor que se suscriba a `installment.overdue` no recibirá nada hoy. Registrado como [[14-audits/contradictions|C-001]].

## Relaciones

- Flujo outbox: [[07-async-processing/events]] · Cola y reintentos: [[07-async-processing/retry-and-dead-letter]]
- Entidad: [[outbox_events]]
