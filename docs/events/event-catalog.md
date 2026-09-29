# Catálogo de eventos de dominio

> **Generado.** No se edita a mano: `yarn docs:events` lo escribe desde `EVENT_REGISTRY`
> (`src/modules/events/event-registry.ts`) y desde los productores reales de `src/`; `yarn check:events-docs`
> (CI) falla si difiere. Fuente: `scripts/docs/generate-event-contract.ts`.

**117 códigos registrados en 12 familias. 28 tienen productor en el código;
los 89 restantes están reservados**: registrarlos permite publicarlos sin cambiar el contrato, pero
hoy ningún código los escribe y un consumidor no debe esperarlos. El contrato AsyncAPI
(`asyncapi/asyncapi.yaml`) declara sólo los emitidos.

`EventsService.publish` rechaza un código fuera del registro (`EVENT_NOT_REGISTERED`), pero los productores que
escriben el outbox directamente (`SequelizeOutboxWriter`, repositorios) no pasan por ahí: si uno usa un código sin
registrar, `process_outbox` lo marca procesado sin consumirlo y deja el aviso `OUTBOX_UNREGISTERED_EVENT`
(`src/modules/runtime-jobs/outbox-unregistered.ts`).

## Cómo se calcula «emitido»

Un código cuenta como emitido si su literal aparece en código de producción de `src/` (sin pruebas), o si un
productor escribe una plantilla con su prefijo (``eventCode: `customer.lifecycle.${…}` ``). No cuentan los
archivos que sólo lo nombran:

- `src/modules/events/event-registry.ts` — el registro: declara, no publica.
- `src/modules/notifications/notification-rules.service.ts` — reglas de canal: consumen.
- `src/modules/workflow-catalog/definitions/` — fichas de procesos: documentan.
- `src/modules/systems-ops/entity-narratives/` — narrativas del catálogo: documentan.
- `src/database/seeders/` — semillas de demostración: datos, no productores.
- `src/database/migrations/` — migraciones: esquema y datos, no productores.
- `src/platform/events/outbound-subscriptions.ts` — suscripciones de entrega al ERP: reenvían lo ya emitido.
- `src/platform/events/outbound-envelope.ts` — forma del sobre de entrega al ERP: reenvía lo ya emitido.

**Aviso** es lo que genera `NotificationRulesService` al consumir el evento (destinatario: canales); `—` significa
que `process_events` lo consume sin generar mensaje.

## `user_security`

Agregados admitidos: `customer`, `user`, `session`, `device` · prioridad por defecto: 0 · emitidos: 0 de 10.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `user.registered` | no (reservado) | — | customer: in_app, email |
| `user.profile.completed` | no (reservado) | — | — |
| `user.email.verified` | no (reservado) | — | customer: in_app |
| `user.phone.verified` | no (reservado) | — | customer: in_app |
| `user.login.succeeded` | no (reservado) | — | — |
| `user.login.failed` | no (reservado) | — | — |
| `user.device.registered` | no (reservado) | — | — |
| `user.device.changed` | no (reservado) | — | — |
| `user.account.locked` | no (reservado) | — | — |
| `user.account.reactivated` | no (reservado) | — | — |

## `kyc_legal`

Agregados admitidos: `customer`, `kyc_case`, `consent`, `legal_document` · prioridad por defecto: 10 · emitidos: 2 de 10.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `kyc.started` | no (reservado) | — | — |
| `kyc.submitted` | no (reservado) | — | — |
| `kyc.approved` | sí | `src/modules/customer-onboarding/application/identity-verdict-event.publisher.ts` | customer: in_app, push, email |
| `kyc.rejected` | sí | `src/modules/customer-onboarding/application/identity-verdict-event.publisher.ts` | customer: in_app, email |
| `kyc.requires_review` | no (reservado) | — | — |
| `consent.accepted` | no (reservado) | — | — |
| `consent.revoked` | no (reservado) | — | — |
| `terms.accepted` | no (reservado) | — | — |
| `privacy_policy.accepted` | no (reservado) | — | — |
| `legal_document.generated` | no (reservado) | — | — |

## `risk_scoring_fraud`

Agregados admitidos: `customer`, `score`, `risk_alert`, `fraud_case` · prioridad por defecto: 20 · emitidos: 0 de 11.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `score.requested` | no (reservado) | — | — |
| `score.calculated` | no (reservado) | — | — |
| `score.approved` | no (reservado) | — | — |
| `score.rejected` | no (reservado) | — | — |
| `score.manual_review_required` | no (reservado) | — | — |
| `risk.signal.detected` | no (reservado) | — | — |
| `risk.alert.created` | no (reservado) | — | operations: in_app |
| `risk.alert.resolved` | no (reservado) | — | — |
| `fraud.rule.triggered` | no (reservado) | — | — |
| `fraud.case.opened` | no (reservado) | — | — |
| `fraud.case.closed` | no (reservado) | — | — |

## `customer_lifecycle`

Agregados admitidos: `customer` · prioridad por defecto: 10 · emitidos: 8 de 8.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `customer.lifecycle.onboarding_in_progress` | sí | `src/modules/customers/repositories/customer-lifecycle.repository.ts` | — |
| `customer.lifecycle.under_review` | sí | `src/modules/customers/repositories/customer-lifecycle.repository.ts` | — |
| `customer.lifecycle.observed` | sí | `src/modules/customers/repositories/customer-lifecycle.repository.ts` | — |
| `customer.lifecycle.active` | sí | `src/modules/customers/repositories/customer-lifecycle.repository.ts` | customer: in_app, push, email, sms |
| `customer.lifecycle.suspended` | sí | `src/modules/customers/repositories/customer-lifecycle.repository.ts` | — |
| `customer.lifecycle.rejected` | sí | `src/modules/customers/repositories/customer-lifecycle.repository.ts` | — |
| `customer.lifecycle.blocked` | sí | `src/modules/customers/repositories/customer-lifecycle.repository.ts` | — |
| `customer.lifecycle.closed` | sí | `src/modules/customers/repositories/customer-lifecycle.repository.ts` | — |

## `credit_admission`

Agregados admitidos: `credit_application`, `customer` · prioridad por defecto: 0 · emitidos: 2 de 2.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `credit.application.submitted` | sí | `src/modules/credit/application/use-cases/submit-credit-application.use-case.ts` | — |
| `credit.decision.recorded` | sí | `src/modules/credit/application/credit-decision-event-publisher.ts` | — |

## `credit_line`

Agregados admitidos: `customer`, `credit_line`, `credit_limit_movement` · prioridad por defecto: 20 · emitidos: 0 de 9.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `credit_line.created` | no (reservado) | — | — |
| `credit_line.approved` | no (reservado) | — | customer: in_app, push, email |
| `credit_line.rejected` | no (reservado) | — | customer: in_app, email |
| `credit_line.increased` | no (reservado) | — | — |
| `credit_line.decreased` | no (reservado) | — | — |
| `credit_line.suspended` | no (reservado) | — | customer: in_app, push, email |
| `credit_line.reactivated` | no (reservado) | — | — |
| `credit_line.expired` | no (reservado) | — | — |
| `credit_limit_movement.created` | no (reservado) | — | — |

## `purchase_downpayment`

Agregados admitidos: `purchase`, `customer`, `merchant` · prioridad por defecto: 30 · emitidos: 0 de 8.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `purchase.created` | no (reservado) | — | customer: in_app, push |
| `purchase.awaiting_downpayment` | no (reservado) | — | customer: in_app, push |
| `purchase.downpayment_confirmed` | no (reservado) | — | customer: in_app, push, email |
| `purchase.downpayment_rejected` | no (reservado) | — | — |
| `purchase.expired` | no (reservado) | — | customer: in_app, email |
| `purchase.cancelled` | no (reservado) | — | — |
| `purchase.approved` | no (reservado) | — | — |
| `purchase.completed` | no (reservado) | — | — |

## `installments_collections`

Agregados admitidos: `installment`, `collection_case`, `customer`, `purchase` · prioridad por defecto: 40 · emitidos: 0 de 14.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `installment.schedule.created` | no (reservado) | — | — |
| `installment.created` | no (reservado) | — | — |
| `installment.due_soon` | no (reservado) | — | customer: in_app, push, email |
| `installment.due_today` | no (reservado) | — | customer: in_app, push, email |
| `installment.grace_period_started` | no (reservado) | — | — |
| `installment.overdue` | no (reservado) | — | customer: in_app, push, email |
| `installment.paid` | no (reservado) | — | customer: in_app, push |
| `installment.partially_paid` | no (reservado) | — | — |
| `installment.defaulted` | no (reservado) | — | — |
| `collection.case.created` | no (reservado) | — | — |
| `collection.reminder.scheduled` | no (reservado) | — | customer: in_app |
| `collection.reminder.sent` | no (reservado) | — | customer: in_app |
| `collection.promise_to_pay.created` | no (reservado) | — | — |
| `collection.case.resolved` | no (reservado) | — | — |

## `payments`

Agregados admitidos: `payment`, `installment`, `purchase`, `customer`, `merchant` · prioridad por defecto: 40 · emitidos: 3 de 3.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `payment.reported` | sí | `src/modules/loan-payment-claims/loan-payment-claims.service.ts` | customer: in_app |
| `payment.confirmed` | sí | `src/modules/loan-payment-claims/partner-payment-claims.service.ts` | customer: in_app, push, email |
| `payment.rejected` | sí | `src/modules/loan-payment-claims/partner-payment-claims.service.ts` | customer: in_app, push, email |

## `merchant_settlement`

Agregados admitidos: `merchant`, `settlement`, `mdr_invoice`, `reconciliation` · prioridad por defecto: 20 · emitidos: 0 de 15.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `merchant.registered` | no (reservado) | — | — |
| `merchant.kyb.submitted` | no (reservado) | — | — |
| `merchant.kyb.approved` | no (reservado) | — | — |
| `merchant.kyb.rejected` | no (reservado) | — | — |
| `merchant.sale.created` | no (reservado) | — | — |
| `merchant.sale.confirmed` | no (reservado) | — | — |
| `merchant.settlement.created` | no (reservado) | — | — |
| `merchant.settlement.ready` | no (reservado) | — | merchant: in_app, email |
| `merchant.settlement.paid` | no (reservado) | — | — |
| `merchant.mdr.invoice.created` | no (reservado) | — | — |
| `merchant.mdr.invoice.due` | no (reservado) | — | merchant: in_app, email |
| `merchant.mdr.invoice.overdue` | no (reservado) | — | merchant: in_app, email |
| `reconciliation.started` | no (reservado) | — | — |
| `reconciliation.matched` | no (reservado) | — | — |
| `reconciliation.unmatched` | no (reservado) | — | — |

## `support_service_management`

Agregados admitidos: `support_case`, `support_channel`, `support_message`, `knowledge_article`, `customer`, `partner` · prioridad por defecto: 20 · emitidos: 13 de 15.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `support.case.created` | sí | `src/modules/support/application/support-case-creation-events.service.ts` | — |
| `support.case.triaged` | no (reservado) | — | — |
| `support.case.assigned` | sí | `src/modules/support/application/support-case-workflow.service.ts` | — |
| `support.case.escalated` | sí | `src/modules/support/application/support-case-escalation.service.ts` | — |
| `support.case.resolved` | sí | `src/modules/support/application/support-case-closure.service.ts` | — |
| `support.case.closed` | sí | `src/modules/support/application/support-case-closure.service.ts` | — |
| `support.case.reopened` | sí | `src/modules/support/application/support-case-closure.service.ts` | — |
| `support.channel.opened` | sí | `src/modules/support/application/support-channel.service.ts` | — |
| `support.channel.closed` | sí | `src/modules/support/application/support-channel.service.ts` | — |
| `support.message.created` | sí | `src/modules/support/application/support-message.service.ts` | — |
| `support.complaint.created` | sí | `src/modules/support/application/support-case-creation-events.service.ts` | — |
| `support.security.escalated` | sí | `src/modules/support/application/support-case-creation-events.service.ts`<br>`src/modules/support/application/support-case-escalation.service.ts` | — |
| `support.sla.warning` | no (reservado) | — | — |
| `support.sla.breached` | sí | `src/modules/support/application/support-sla.service.ts` | — |
| `support.knowledge.published` | sí | `src/modules/support/application/support-knowledge.service.ts` | — |

## `notifications`

Agregados admitidos: `notification`, `template`, `customer`, `internal_user` · prioridad por defecto: 10 · emitidos: 0 de 12.

| Código | Emitido | Productor | Aviso |
|---|---|---|---|
| `notification.requested` | no (reservado) | — | — |
| `notification.created` | no (reservado) | — | — |
| `notification.queued` | no (reservado) | — | — |
| `notification.sent` | no (reservado) | — | — |
| `notification.failed` | no (reservado) | — | — |
| `notification.delivered` | no (reservado) | — | — |
| `notification.read` | no (reservado) | — | — |
| `notification.cancelled` | no (reservado) | — | — |
| `notification.preference.updated` | no (reservado) | — | — |
| `template.created` | no (reservado) | — | — |
| `template.updated` | no (reservado) | — | — |
| `template.disabled` | no (reservado) | — | — |
