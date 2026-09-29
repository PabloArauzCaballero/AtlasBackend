import { describe, expect, it } from '@jest/globals';
import {
  NotificationRulesService,
  POLICY_EVENT_CODES_WITHOUT_SENDER,
} from '../../../src/modules/notifications/notification-rules.service.js';

/**
 * `NotificationRulesService` es una tabla de mapeo evento -> canales, sin dependencias ni I/O. Un
 * error de mapeo aquí es exactamente el tipo de bug que un test detecta y una demo manual no: un
 * evento de cliente que termina notificando a operaciones por un typo en el código de evento.
 *
 * Desde el 2026-09-29 la tabla sólo declara lo que alguien publica: las 19 reglas sin productor
 * (mora, vencimientos, línea, compras, comercio…) se retiraron, y este archivo fija que siguen fuera.
 */
describe('NotificationRulesService.getRulesForEvent', () => {
  const service = new NotificationRulesService();

  it('returns an empty array for an event code with no rule registered', () => {
    expect(service.getRulesForEvent('does.not.exist')).toEqual([]);
  });

  describe('customer events', () => {
    it('resolves recipientType "customer" with recipientIdPath ["customerId"]', () => {
      const [rule] = service.getRulesForEvent('kyc.approved');
      expect(rule.recipientType).toBe('customer');
      expect(rule.recipientIdPath).toEqual(['customerId']);
    });

    it('resolves the exact channel list configured for that event, not a default', () => {
      expect(service.getRulesForEvent('payment.reported')[0].channels).toEqual(['in_app']);
      expect(service.getRulesForEvent('kyc.approved')[0].channels).toEqual(['in_app', 'push', 'email']);
      expect(service.getRulesForEvent('kyc.rejected')[0].channels).toEqual(['in_app', 'email']);
    });

    it('only the account verification is required; a payment notice can be switched off by the customer', () => {
      expect(service.getRulesForEvent('customer.lifecycle.active')[0].required).toBe(true);
      expect(service.getRulesForEvent('kyc.approved')[0].required).toBe(false);
      expect(service.getRulesForEvent('payment.confirmed')[0].required).toBe(false);
    });

    it('customer.lifecycle.active avisa «tu cuenta ha sido verificada» por app, push, correo y SMS, siempre', () => {
      const [rule] = service.getRulesForEvent('customer.lifecycle.active');
      expect(rule.channels).toEqual(['in_app', 'push', 'email', 'sms']);
      expect(rule.required).toBe(true);
      expect(rule.templatePrefix).toBe('customer_lifecycle_active');
      // Los demás estados siguen sin mensaje: sólo la activación es una noticia para el cliente.
      expect(service.getRulesForEvent('customer.lifecycle.under_review')).toEqual([]);
    });

    it('derives templatePrefix by replacing every dot with an underscore', () => {
      expect(service.getRulesForEvent('payment.confirmed')[0].templatePrefix).toBe('payment_confirmed');
    });
  });

  /*
   * La mora y el vencimiento NO avisan al deudor: es una decisión de producto y regulatoria sin tomar,
   * y `LoanDelinquencyService` no publica ningún evento. Que una regla vuelva a declararlos sin
   * productor es justo lo que este caso (y el guardián de productores) impiden.
   */
  it('no rule promises a notice that nobody sends: delinquency, due dates, credit line, purchases and merchant billing are out', () => {
    const retired = [
      'installment.due_soon',
      'installment.due_today',
      'installment.overdue',
      'installment.paid',
      'credit_line.approved',
      'credit_line.rejected',
      'credit_line.suspended',
      'purchase.created',
      'purchase.awaiting_downpayment',
      'purchase.downpayment_confirmed',
      'purchase.expired',
      'collection.reminder.scheduled',
      'collection.reminder.sent',
      'merchant.settlement.ready',
      'merchant.mdr.invoice.due',
      'merchant.mdr.invoice.overdue',
      'risk.alert.created',
      'user.registered',
      'user.email.verified',
      'user.phone.verified',
    ];
    for (const code of retired) expect(service.getRulesForEvent(code)).toEqual([]);
  });

  describe('operations events (aviso interno de plazos de soporte)', () => {
    it.each(['support.sla.warning', 'support.sla.breached'])('%s va a operaciones, sólo por bandeja, y no se puede apagar', (eventCode) => {
      const [rule] = service.getRulesForEvent(eventCode);
      expect(rule.recipientType).toBe('operations');
      expect(rule.recipientIdPath).toEqual(['assignedTeamId']);
      expect(rule.channels).toEqual(['in_app']);
      expect(rule.required).toBe(true);
      expect(rule.templatePrefix).toBe(eventCode.replaceAll('.', '_'));
    });
  });

  it('an event code never matches more than one category, and listRuleEventCodes lists exactly the codes that have a rule', () => {
    const codes = service.listRuleEventCodes();
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.sort()).toEqual(
      [
        'customer.lifecycle.active',
        'kyc.approved',
        'kyc.rejected',
        'payment.confirmed',
        'payment.rejected',
        'payment.reported',
        'support.sla.breached',
        'support.sla.warning',
      ].sort(),
    );
    for (const code of codes) expect(service.getRulesForEvent(code)).toHaveLength(1);
  });

  it('the policy codes without a sender are the ones of the delinquency and due-date notices', () => {
    expect([...POLICY_EVENT_CODES_WITHOUT_SENDER]).toEqual(['cuota_por_vencer', 'cuota_vencida']);
  });
});
