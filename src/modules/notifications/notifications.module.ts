import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerContactMethodModel,
  DeviceTokenModel,
  NotificationDeliveryModel,
  NotificationMessageModel,
  NotificationTemplateModel,
  UserNotificationPreferenceModel,
} from '../../database/models/index.js';
import { InAppNotificationAdapter } from './adapters/in-app-notification.adapter.js';
import { EmailNotificationAdapter } from './adapters/email.adapter.js';
import { NotificationProviderConfigService } from './adapters/notification-provider-config.service.js';
import { PushNotificationAdapter } from './adapters/push.adapter.js';
import { SmsNotificationAdapter } from './adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from './adapters/whatsapp.adapter.js';
import { NotificationOrchestratorService } from './notification-orchestrator.service.js';
import { NotificationRulesService } from './notification-rules.service.js';
import { NotificationTemplateRendererService } from './notification-template-renderer.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      NotificationTemplateModel,
      NotificationMessageModel,
      NotificationDeliveryModel,
      UserNotificationPreferenceModel,
      DeviceTokenModel,
      CustomerContactMethodModel,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationRulesService,
    NotificationTemplateRendererService,
    NotificationOrchestratorService,
    InAppNotificationAdapter,
    NotificationProviderConfigService,
    EmailNotificationAdapter,
    PushNotificationAdapter,
    SmsNotificationAdapter,
    WhatsAppNotificationAdapter,
  ],
  exports: [NotificationOrchestratorService, NotificationsService, NotificationsRepository],
})
export class NotificationsModule {}
