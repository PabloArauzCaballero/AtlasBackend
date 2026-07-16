import { describe, expect, it } from '@jest/globals';
import { NotificationRulesService } from '../../../src/modules/notifications/notification-rules.service.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 3): primer test real de
 * `notifications`. Se empieza por
 * `NotificationRulesService` porque es lógica pura (una tabla de mapeo evento -> canales, sin
 * dependencias ni I/O), y porque un error de mapeo aquí es exactamente el tipo de bug que un
 * test detecta y una demo manual no: un evento de cliente que termina notificando al canal de
 * comercio o de operaciones por un typo en el código de evento.
 */
describe('NotificationRulesService.getRulesForEvent', () => {
  const service = new NotificationRulesService();

  it('returns an empty array for an event code with no rule registered', () => {
    expect(service.getRulesForEvent('does.not.exist')).toEqual([]);
  });

  describe('customer events', () => {
    it('resolves recipientType "customer" with recipientIdPath ["customerId"]', () => {
      const [rule] = service.getRulesForEvent('user.registered');
      expect(rule.recipientType).toBe('customer');
      expect(rule.recipientIdPath).toEqual(['customerId']);
    });

    it('resolves the exact channel list configured for that event, not a default', () => {
      expect(service.getRulesForEvent('user.email.verified')[0].channels).toEqual(['in_app']);
      expect(service.getRulesForEvent('kyc.approved')[0].channels).toEqual(['in_app', 'push', 'email']);
    });

    it('marks "installment.overdue" and "credit_line.suspended" as required, unlike other customer events', () => {
      expect(service.getRulesForEvent('installment.overdue')[0].required).toBe(true);
      expect(service.getRulesForEvent('credit_line.suspended')[0].required).toBe(true);
      expect(service.getRulesForEvent('user.registered')[0].required).toBe(false);
      expect(service.getRulesForEvent('purchase.created')[0].required).toBe(false);
    });

    it('derives templatePrefix by replacing every dot with an underscore', () => {
      expect(service.getRulesForEvent('installment.due_soon')[0].templatePrefix).toBe('installment_due_soon');
    });
  });

  describe('merchant events', () => {
    it('resolves recipientType "merchant" with recipientIdPath ["merchantId"], and is never a customer event even if the code looks similar', () => {
      const [rule] = service.getRulesForEvent('merchant.settlement.ready');
      expect(rule.recipientType).toBe('merchant');
      expect(rule.recipientIdPath).toEqual(['merchantId']);
    });

    it('every merchant event is required: true, unconditionally', () => {
      expect(service.getRulesForEvent('merchant.settlement.ready')[0].required).toBe(true);
      expect(service.getRulesForEvent('merchant.mdr.invoice.due')[0].required).toBe(true);
      expect(service.getRulesForEvent('merchant.mdr.invoice.overdue')[0].required).toBe(true);
    });
  });

  describe('operations events', () => {
    it('resolves recipientType "operations" with recipientIdPath ["assignedTeamId"]', () => {
      const [rule] = service.getRulesForEvent('risk.alert.created');
      expect(rule.recipientType).toBe('operations');
      expect(rule.recipientIdPath).toEqual(['assignedTeamId']);
      expect(rule.required).toBe(true);
    });
  });

  it('an event code never matches more than one category — customer, merchant and operations event codes are disjoint sets', () => {
    const allCustomerCodes = [
      'user.registered',
      'user.email.verified',
      'user.phone.verified',
      'kyc.approved',
      'kyc.rejected',
      'credit_line.approved',
      'credit_line.rejected',
      'credit_line.suspended',
      'purchase.created',
      'purchase.awaiting_downpayment',
      'purchase.downpayment_confirmed',
      'purchase.expired',
      'installment.due_soon',
      'installment.due_today',
      'installment.overdue',
      'installment.paid',
      'payment.reported',
      'payment.confirmed',
      'payment.rejected',
      'collection.reminder.scheduled',
      'collection.reminder.sent',
    ];
    const merchantCodes = ['merchant.settlement.ready', 'merchant.mdr.invoice.due', 'merchant.mdr.invoice.overdue'];
    const operationsCodes = ['risk.alert.created'];

    for (const code of allCustomerCodes) {
      expect(service.getRulesForEvent(code)[0].recipientType).toBe('customer');
    }
    for (const code of merchantCodes) {
      expect(service.getRulesForEvent(code)[0].recipientType).toBe('merchant');
    }
    for (const code of operationsCodes) {
      expect(service.getRulesForEvent(code)[0].recipientType).toBe('operations');
    }
  });
});
