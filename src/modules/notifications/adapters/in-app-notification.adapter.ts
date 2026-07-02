import { Injectable } from '@nestjs/common';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';
import { NotificationChannelAdapter } from './notification-channel-adapter.js';

@Injectable()
export class InAppNotificationAdapter implements NotificationChannelAdapter {
  getProviderName(): string {
    return 'atlas_in_app';
  }

  supports(channel: NotificationChannel): boolean {
    return channel === 'in_app';
  }

  validatePayload(message: NotificationMessagePayload): boolean {
    return message.channel === 'in_app' && Boolean(message.recipientId) && Boolean(message.body);
  }

  async send(message: NotificationMessagePayload): Promise<DeliveryResult> {
    return {
      status: 'delivered',
      provider: this.getProviderName(),
      providerMessageId: `in_app-${message.id}`,
      response: { storedInAtlas: true },
      errorCode: null,
      errorMessage: null,
    };
  }
}
