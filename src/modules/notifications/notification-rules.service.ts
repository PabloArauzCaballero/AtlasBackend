/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { NotificationRule } from './notification-types.js';

/**
 * Las reglas que de verdad se cumplen: cada evento de esta tabla tiene un productor en `src/`
 * (comprobado por `test/unit/notifications/notification-rules-producers.spec.ts`).
 *
 * ## Lo que NO está aquí, a propósito
 *
 * Hasta el 2026-09-29 la tabla declaraba 26 reglas y 19 no tenían quien publicara su evento:
 * `installment.due_soon|due_today|overdue|paid`, `credit_line.*`, `purchase.*`, `collection.reminder.*`,
 * `merchant.settlement.ready`, `merchant.mdr.invoice.*`, `risk.alert.created` y `user.*`. `installment.overdue`
 * estaba además marcada `required`: la tabla prometía un aviso de mora irrenunciable que ningún código
 * enviaba (`LoanDelinquencyService.sweep` no publica nada). Una regla sin productor no avisa a nadie y
 * hace creer que alguien avisa, así que se retiraron.
 *
 * **Avisar de la mora o del vencimiento al deudor es una decisión de producto y regulatoria, aún no
 * tomada.** Cuando se tome, se publica el evento desde el barrido de mora (con `aggregateVersion` e
 * `idempotencyKey`), se añade la regla aquí y se siembra su plantilla; el guardián de productores impide
 * declararla antes.
 */
const CUSTOMER_EVENTS: Record<string, string[]> = {
  'kyc.approved': ['in_app', 'push', 'email'],
  'kyc.rejected': ['in_app', 'email'],
  // «Tu cuenta ha sido verificada»: el paso a `active` tras la revisión. SMS porque el teléfono es el
  // contacto que el alta exige verificar; el correo es opcional. Plantillas en 20260928120000.
  'customer.lifecycle.active': ['in_app', 'push', 'email', 'sms'],
  'payment.reported': ['in_app'],
  'payment.confirmed': ['in_app', 'push', 'email'],
  'payment.rejected': ['in_app', 'push', 'email'],
};

const REQUIRED_CUSTOMER_EVENTS = ['customer.lifecycle.active'];

/**
 * Aviso INTERNO de plazos de soporte: lo publica `SupportSlaService` (`sweepWarnings` y `sweepBreaches`).
 * El destinatario es operaciones (`assignedTeamId` del payload o, sin él, el buzón `operations`); sólo
 * bandeja, porque un aviso de plazo no debe salir de la casa. Plantillas en 20260929210000.
 */
const OPERATIONS_EVENTS: Record<string, string[]> = {
  'support.sla.warning': ['in_app'],
  'support.sla.breached': ['in_app'],
};

/**
 * Eventos de las políticas de preferencias (`notification_policies.event_code`, otro espacio de códigos
 * que el de las reglas) cuyo aviso NO se envía: nadie publica el hecho que lo dispararía. La pantalla de
 * avisos del cliente no los ofrece —un interruptor para un aviso que no llega es una promesa falsa—.
 * Se vacía esta lista cuando exista el productor de la mora (ver arriba).
 */
export const POLICY_EVENT_CODES_WITHOUT_SENDER: readonly string[] = ['cuota_por_vencer', 'cuota_vencida'];

@Injectable()
export class NotificationRulesService {
  /** Los códigos de evento con regla: lo que el guardián de productores compara con `src/`. */
  listRuleEventCodes(): string[] {
    return [...Object.keys(CUSTOMER_EVENTS), ...Object.keys(OPERATIONS_EVENTS)];
  }

  getRulesForEvent(eventCode: string): NotificationRule[] {
    const customerChannels = CUSTOMER_EVENTS[eventCode];
    if (customerChannels) {
      return [
        {
          eventCode,
          channels: customerChannels as NotificationRule['channels'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: REQUIRED_CUSTOMER_EVENTS.includes(eventCode),
          templatePrefix: eventCode.replaceAll('.', '_'),
        },
      ];
    }

    const operationsChannels = OPERATIONS_EVENTS[eventCode];
    if (operationsChannels) {
      return [
        {
          eventCode,
          channels: operationsChannels as NotificationRule['channels'],
          recipientType: 'operations',
          recipientIdPath: ['assignedTeamId'],
          required: true,
          templatePrefix: eventCode.replaceAll('.', '_'),
        },
      ];
    }

    return [];
  }
}
