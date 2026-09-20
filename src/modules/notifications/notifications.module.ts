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
  NotificationPolicyModel,
  TenantModel,
  UserNotificationPreferenceModel,
} from '../../database/models/index.js';
import { InternalUsersModule } from '../internal-users/internal-users.module.js';
import { InAppNotificationAdapter } from './adapters/in-app-notification.adapter.js';
import { EmailNotificationAdapter } from './adapters/email.adapter.js';
import { GmailMailModule } from './adapters/gmail/gmail-mail.module.js';
import { PushNotificationAdapter } from './adapters/push.adapter.js';
import { SmsNotificationAdapter } from './adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from './adapters/whatsapp.adapter.js';
import { NotificationBroadcastService } from './notification-broadcast.service.js';
import { NOTIFICATION_REQUEST_PORT } from './application/ports/notification-request.port.js';
import { RECIPIENT_DIRECTORY_PORT } from './application/ports/recipient-directory.port.js';
import { DEVICE_TOKEN_REGISTRY_PORT } from './application/ports/device-token-registry.port.js';
import { SequelizeDeviceTokenRegistryAdapter } from './infrastructure/sequelize-device-token-registry.adapter.js';
import { CustomersModule } from '../customers/customers.module.js';
import { CustomerRecipientDirectoryAdapter } from '../customers/infrastructure/customer-recipient-directory.adapter.js';
import { LocalNotificationRequestAdapter } from './infrastructure/local-notification-request.adapter.js';
import { NotificationEventConsumer } from './infrastructure/notification-event.consumer.js';
import { LocalRecipientDirectoryAdapter } from './infrastructure/directory/local-recipient-directory.adapter.js';
import { EVENT_CONSUMERS } from '../../platform/events/event-consumer.port.js';
import { NotificationOrchestratorService } from './notification-orchestrator.service.js';
import { NotificationRulesService } from './notification-rules.service.js';
import { NotificationTemplateRendererService } from './notification-template-renderer.service.js';
import { NotificationPoliciesRepository } from './notification-policies.repository.js';
import { NotificationPreferencesRepository } from './notification-preferences.repository.js';
import { NotificationTemplatesRepository } from './notification-templates.repository.js';
import { NotificationPoliciesOperationsController } from './notification-policies-operations.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { CustomerNotificationsController } from './customer-notifications.controller.js';
import { NotificationTemplatesController } from './notification-templates.controller.js';
import { NotificationBroadcastController } from './notification-broadcast.controller.js';
import { NotificationProviderCallbacksController } from './notification-provider-callbacks.controller.js';
import { NotificationProviderCallbacksService } from './notification-provider-callbacks.service.js';
import { NotificationDeliveryStatusRepository } from './notification-delivery-status.repository.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationAudienceSegmentModel, NotificationCampaignModel } from '../../database/models/index.js';
import { CAMPAIGN_AUDIENCE_PORT } from '../../platform/contracts/campaign-audience.js';
import { CustomerCampaignAudienceAdapter } from '../customers/infrastructure/customer-campaign-audience.adapter.js';
import { NotificationAudienceSegmentsController } from './campaigns/notification-audience-segments.controller.js';
import { NotificationCampaignAudienceService } from './campaigns/notification-campaign-audience.service.js';
import { NotificationCampaignRunnerService } from './campaigns/notification-campaign-runner.service.js';
import { NotificationCampaignTestSendService } from './campaigns/notification-campaign-test-send.service.js';
import { NotificationCampaignService } from './campaigns/notification-campaign.service.js';
import { NotificationCampaignsController } from './campaigns/notification-campaigns.controller.js';
import { NotificationCampaignsRepository } from './campaigns/notification-campaigns.repository.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      NotificationTemplateModel,
      NotificationPolicyModel,
      NotificationMessageModel,
      NotificationDeliveryModel,
      UserNotificationPreferenceModel,
      DeviceTokenModel,
      CustomerContactMethodModel,
      TenantModel,
      NotificationCampaignModel,
      NotificationAudienceSegmentModel,
    ]),
    CustomersModule,
    InternalUsersModule,
    GmailMailModule,
  ],
  controllers: [
    NotificationsController,
    CustomerNotificationsController,
    NotificationTemplatesController,
    NotificationBroadcastController,
    NotificationPoliciesOperationsController,
    NotificationCampaignsController,
    NotificationAudienceSegmentsController,
    // Twilio y SendGrid avisan por su cuenta cómo terminó cada envío; la firma es lo que los identifica.
    NotificationProviderCallbacksController,
  ],
  providers: [
    LocalNotificationRequestAdapter,
    { provide: NOTIFICATION_REQUEST_PORT, useExisting: LocalNotificationRequestAdapter },
    // AT-035: Mensajería se registra como consumidor de eventos; el relay la recibe por el token.
    NotificationEventConsumer,
    // AT-039/AT-040: direcciones por el puerto de Clientes; OTP por contrato.
    LocalRecipientDirectoryAdapter,
    { provide: EVENT_CONSUMERS, useFactory: (consumer: NotificationEventConsumer) => [consumer], inject: [NotificationEventConsumer] },
    { provide: RECIPIENT_DIRECTORY_PORT, useExisting: CustomerRecipientDirectoryAdapter },
    // Campañas: la audiencia la resuelve Clientes por el puerto; el resto vive en `campaigns/`.
    { provide: CAMPAIGN_AUDIENCE_PORT, useExisting: CustomerCampaignAudienceAdapter },
    NotificationCampaignsRepository,
    NotificationCampaignAudienceService,
    NotificationCampaignService,
    NotificationCampaignRunnerService,
    NotificationCampaignTestSendService,
    // Baja de los tokens que el proveedor declara muertos (410 de APNs).
    SequelizeDeviceTokenRegistryAdapter,
    { provide: DEVICE_TOKEN_REGISTRY_PORT, useExisting: SequelizeDeviceTokenRegistryAdapter },
    NotificationsRepository,
    NotificationDeliveryStatusRepository,
    NotificationProviderCallbacksService,
    NotificationTemplatesRepository,
    NotificationPoliciesRepository,
    NotificationPreferencesRepository,
    NotificationsService,
    NotificationRulesService,
    NotificationTemplateRendererService,
    NotificationOrchestratorService,
    NotificationBroadcastService,
    InAppNotificationAdapter,
    EmailNotificationAdapter,
    PushNotificationAdapter,
    SmsNotificationAdapter,
    WhatsAppNotificationAdapter,
  ],
  // Los adaptadores de SMS/WhatsApp se exportan para que `customer-onboarding` pueda entregar el
  // código de verificación de contacto por el canal que el cliente eligió. Antes solo los usaba el
  // orquestador de notificaciones, y el OTP de onboarding no tenía por dónde salir.
  // `GmailMailModule` se re-exporta por la misma razón: el `sendEmail()` tipado de su adaptador
  // (HTML, cc/bcc, reply-to) es el camino para un correo transaccional puntual sin pasar por el
  // orquestador. Quien sólo necesite eso puede importar ese módulo directamente y ahorrarse las
  // siete tablas y los cinco canales que arrastra éste.
  exports: [
    // AT-017: la entrada pública. El resto de exportaciones es legado hasta que sus consumidores migren.
    NOTIFICATION_REQUEST_PORT,
    RECIPIENT_DIRECTORY_PORT,
    EVENT_CONSUMERS,
    NotificationOrchestratorService,
    NotificationPoliciesRepository,
    NotificationsService,
    NotificationsRepository,
    NotificationBroadcastService,
    SmsNotificationAdapter,
    WhatsAppNotificationAdapter,
    GmailMailModule,
  ],
})
export class NotificationsModule {}
