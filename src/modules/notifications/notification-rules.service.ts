import { Injectable } from '@nestjs/common';
import { NotificationRule } from './notification-types.js';

const CUSTOMER_EVENTS: Record<string, string[]> = {
  'user.registered': ['in_app', 'email'],
  'user.email.verified': ['in_app'],
  'user.phone.verified': ['in_app'],
  'kyc.approved': ['in_app', 'push', 'email'],
  'kyc.rejected': ['in_app', 'email'],
  'credit_line.approved': ['in_app', 'push', 'email'],
  'credit_line.rejected': ['in_app', 'email'],
  'credit_line.suspended': ['in_app', 'push', 'email'],
  'purchase.created': ['in_app', 'push'],
  'purchase.awaiting_downpayment': ['in_app', 'push'],
  'purchase.downpayment_confirmed': ['in_app', 'push', 'email'],
  'purchase.expired': ['in_app', 'email'],
  'installment.due_soon': ['in_app', 'push', 'email'],
  'installment.due_today': ['in_app', 'push', 'email'],
  'installment.overdue': ['in_app', 'push', 'email'],
  'installment.paid': ['in_app', 'push'],
  'payment.reported': ['in_app'],
  'payment.confirmed': ['in_app', 'push', 'email'],
  'payment.rejected': ['in_app', 'push', 'email'],
  'collection.reminder.scheduled': ['in_app'],
  'collection.reminder.sent': ['in_app'],
};

const MERCHANT_EVENTS: Record<string, string[]> = {
  'merchant.settlement.ready': ['in_app', 'email'],
  'merchant.mdr.invoice.due': ['in_app', 'email'],
  'merchant.mdr.invoice.overdue': ['in_app', 'email'],
};

const OPERATIONS_EVENTS: Record<string, string[]> = {
  'risk.alert.created': ['in_app'],
};

@Injectable()
export class NotificationRulesService {
  getRulesForEvent(eventCode: string): NotificationRule[] {
    const customerChannels = CUSTOMER_EVENTS[eventCode];
    if (customerChannels) {
      return [
        {
          eventCode,
          channels: customerChannels as NotificationRule['channels'],
          recipientType: 'customer',
          recipientIdPath: ['customerId'],
          required: ['installment.overdue', 'credit_line.suspended'].includes(eventCode),
          templatePrefix: eventCode.replaceAll('.', '_'),
        },
      ];
    }

    const merchantChannels = MERCHANT_EVENTS[eventCode];
    if (merchantChannels) {
      return [
        {
          eventCode,
          channels: merchantChannels as NotificationRule['channels'],
          recipientType: 'merchant',
          recipientIdPath: ['merchantId'],
          required: true,
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
