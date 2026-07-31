/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
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
import { NotificationPreferencesRepository } from './notification-preferences.repository.js';
import { NotificationTemplatesRepository } from './notification-templates.repository.js';
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
    NotificationTemplatesRepository,
    NotificationPreferencesRepository,
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
  // Los adaptadores de SMS/WhatsApp se exportan para que `customer-onboarding` pueda entregar el
  // código de verificación de contacto por el canal que el cliente eligió. Antes solo los usaba el
  // orquestador de notificaciones, y el OTP de onboarding no tenía por dónde salir.
  exports: [
    NotificationOrchestratorService,
    NotificationsService,
    NotificationsRepository,
    NotificationBroadcastService,
    SmsNotificationAdapter,
    WhatsAppNotificationAdapter,
  ],
})
export class NotificationsModule {}
