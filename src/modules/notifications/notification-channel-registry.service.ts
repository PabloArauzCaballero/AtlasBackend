/**
 * @file Catálogo de adaptadores de canal disponibles para el envío.
 * @business Cada canal (app, correo, push, SMS, WhatsApp) sale por su propio proveedor.
 * @system resuelve el adaptador que soporta un canal.
 */
import { Injectable } from '@nestjs/common';
import { NotificationChannelAdapter } from './adapters/notification-channel-adapter.js';
import { InAppNotificationAdapter } from './adapters/in-app-notification.adapter.js';
import { EmailNotificationAdapter } from './adapters/email.adapter.js';
import { PushNotificationAdapter } from './adapters/push.adapter.js';
import { SmsNotificationAdapter } from './adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from './adapters/whatsapp.adapter.js';
import { NotificationChannel } from './notification-types.js';

@Injectable()
export class NotificationChannelRegistry {
  constructor(
    private readonly inAppAdapter: InAppNotificationAdapter,
    private readonly emailAdapter: EmailNotificationAdapter,
    private readonly pushAdapter: PushNotificationAdapter,
    private readonly smsAdapter: SmsNotificationAdapter,
    private readonly whatsappAdapter: WhatsAppNotificationAdapter,
  ) {}

  resolve(channel: NotificationChannel): NotificationChannelAdapter | undefined {
    const adapters = [this.inAppAdapter, this.emailAdapter, this.pushAdapter, this.smsAdapter, this.whatsappAdapter];
    return adapters.find((candidate) => candidate.supports(channel));
  }
}
