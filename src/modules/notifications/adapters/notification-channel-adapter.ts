import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';

export interface NotificationChannelAdapter {
  getProviderName(): string;
  supports(channel: NotificationChannel): boolean;
  validatePayload(message: NotificationMessagePayload): boolean;
  send(message: NotificationMessagePayload): Promise<DeliveryResult>;
}
