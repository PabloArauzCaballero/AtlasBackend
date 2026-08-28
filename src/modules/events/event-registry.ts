/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza desacopla procesos de negocio y permite reintentos auditables sin perder eventos.
 * @system registra definiciones, outbox y procesamiento idempotente de eventos de dominio.
 */
import { EventRegistryItem } from './event-types.js';

const eventGroups: Array<{ family: string; events: string[]; aggregateTypes: string[]; priority?: number }> = [
  {
    family: 'user_security',
    aggregateTypes: ['customer', 'user', 'session', 'device'],
    events: [
      'user.registered',
      'user.profile.completed',
      'user.email.verified',
      'user.phone.verified',
      'user.login.succeeded',
      'user.login.failed',
      'user.device.registered',
      'user.device.changed',
      'user.account.locked',
      'user.account.reactivated',
    ],
  },
  {
    family: 'kyc_legal',
    aggregateTypes: ['customer', 'kyc_case', 'consent', 'legal_document'],
    events: [
      'kyc.started',
      'kyc.submitted',
      'kyc.approved',
      'kyc.rejected',
      'kyc.requires_review',
      'consent.accepted',
      'consent.revoked',
      'terms.accepted',
      'privacy_policy.accepted',
      'legal_document.generated',
    ],
    priority: 10,
  },
  {
    family: 'risk_scoring_fraud',
    aggregateTypes: ['customer', 'score', 'risk_alert', 'fraud_case'],
    events: [
      'score.requested',
      'score.calculated',
      'score.approved',
      'score.rejected',
      'score.manual_review_required',
      'risk.signal.detected',
      'risk.alert.created',
      'risk.alert.resolved',
      'fraud.rule.triggered',
      'fraud.case.opened',
      'fraud.case.closed',
    ],
    priority: 20,
  },
  {
    family: 'credit_line',
    aggregateTypes: ['customer', 'credit_line', 'credit_limit_movement'],
    events: [
      'credit_line.created',
      'credit_line.approved',
      'credit_line.rejected',
      'credit_line.increased',
      'credit_line.decreased',
      'credit_line.suspended',
      'credit_line.reactivated',
      'credit_line.expired',
      'credit_limit_movement.created',
    ],
    priority: 20,
  },
  {
    family: 'purchase_downpayment',
    aggregateTypes: ['purchase', 'customer', 'merchant'],
    events: [
      'purchase.created',
      'purchase.awaiting_downpayment',
      'purchase.downpayment_confirmed',
      'purchase.downpayment_rejected',
      'purchase.expired',
      'purchase.cancelled',
      'purchase.approved',
      'purchase.completed',
    ],
    priority: 30,
  },
  {
    family: 'installments_collections',
    aggregateTypes: ['installment', 'collection_case', 'customer', 'purchase'],
    events: [
      'installment.schedule.created',
      'installment.created',
      'installment.due_soon',
      'installment.due_today',
      'installment.grace_period_started',
      'installment.overdue',
      'installment.paid',
      'installment.partially_paid',
      'installment.defaulted',
      'collection.case.created',
      'collection.reminder.scheduled',
      'collection.reminder.sent',
      'collection.promise_to_pay.created',
      'collection.case.resolved',
    ],
    priority: 40,
  },
  {
    family: 'payments',
    aggregateTypes: ['payment', 'installment', 'purchase', 'customer', 'merchant'],
    events: ['payment.reported', 'payment.confirmed', 'payment.rejected'],
    priority: 40,
  },
  {
    family: 'merchant_settlement',
    aggregateTypes: ['merchant', 'settlement', 'mdr_invoice', 'reconciliation'],
    events: [
      'merchant.registered',
      'merchant.kyb.submitted',
      'merchant.kyb.approved',
      'merchant.kyb.rejected',
      'merchant.sale.created',
      'merchant.sale.confirmed',
      'merchant.settlement.created',
      'merchant.settlement.ready',
      'merchant.settlement.paid',
      'merchant.mdr.invoice.created',
      'merchant.mdr.invoice.due',
      'merchant.mdr.invoice.overdue',
      'reconciliation.started',
      'reconciliation.matched',
      'reconciliation.unmatched',
    ],
    priority: 20,
  },
  {
    /*
     * Soporte y gestión de servicio (ISO/IEC 20000-1). Los consumidores de estos eventos son el
     * motor de notificaciones —que avisa al cliente sin que soporte tenga que acordarse—, analítica
     * y el tablero del supervisor. Van por outbox y no por llamada directa para que un fallo del
     * canal de avisos no impida cerrar un caso.
     */
    family: 'support_service_management',
    aggregateTypes: ['support_case', 'support_channel', 'support_message', 'knowledge_article', 'customer', 'partner'],
    events: [
      'support.case.created',
      'support.case.triaged',
      'support.case.assigned',
      'support.case.escalated',
      'support.case.resolved',
      'support.case.closed',
      'support.case.reopened',
      'support.channel.opened',
      'support.channel.closed',
      'support.message.created',
      'support.complaint.created',
      'support.security.escalated',
      'support.sla.warning',
      'support.sla.breached',
      'support.knowledge.published',
    ],
    priority: 20,
  },
  {
    family: 'notifications',
    aggregateTypes: ['notification', 'template', 'customer', 'internal_user'],
    events: [
      'notification.requested',
      'notification.created',
      'notification.queued',
      'notification.sent',
      'notification.failed',
      'notification.delivered',
      'notification.read',
      'notification.cancelled',
      'notification.preference.updated',
      'template.created',
      'template.updated',
      'template.disabled',
    ],
    priority: 10,
  },
];

export const EVENT_REGISTRY: Record<string, EventRegistryItem> = eventGroups.reduce<Record<string, EventRegistryItem>>(
  (registry, group) => {
    for (const code of group.events) {
      registry[code] = {
        code,
        family: group.family,
        version: 1,
        description: `Evento interno ATLAS: ${code}`,
        defaultPriority: group.priority ?? 0,
        allowedAggregateTypes: group.aggregateTypes,
      };
    }
    return registry;
  },
  {},
);

export function getEventDefinition(eventCode: string): EventRegistryItem | null {
  return EVENT_REGISTRY[eventCode] ?? null;
}

export function listEventDefinitions(): EventRegistryItem[] {
  return Object.values(EVENT_REGISTRY).sort((a, b) => a.code.localeCompare(b.code));
}
