import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerContactMethodModel,
  DeviceTokenModel,
  NotificationDeliveryModel,
  NotificationMessageModel,
  NotificationTemplateModel,
  TenantModel,
  UserNotificationPreferenceModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { InternalUsersModule } from '../internal-users/internal-users.module.js';
import { InAppNotificationAdapter } from './adapters/in-app-notification.adapter.js';
import { EmailNotificationAdapter } from './adapters/email.adapter.js';
import { NotificationProviderConfigService } from './adapters/notification-provider-config.service.js';
import { PushNotificationAdapter } from './adapters/push.adapter.js';
import { SmsNotificationAdapter } from './adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from './adapters/whatsapp.adapter.js';
import { NotificationBroadcastService } from './notification-broadcast.service.js';
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
      TenantModel,
    ]),
    CustomersModule,
    InternalUsersModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationRulesService,
    NotificationTemplateRendererService,
    NotificationOrchestratorService,
    NotificationBroadcastService,
    InAppNotificationAdapter,
    NotificationProviderConfigService,
    EmailNotificationAdapter,
    PushNotificationAdapter,
    SmsNotificationAdapter,
    WhatsAppNotificationAdapter,
  ],
  exports: [NotificationOrchestratorService, NotificationsService, NotificationsRepository, NotificationBroadcastService],
})
export class NotificationsModule {}
