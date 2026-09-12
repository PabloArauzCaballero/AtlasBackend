/**
 * @file Raíz de composición del worker de Mensajería del piloto (AT-057).
 * @business Un proceso que sólo sabe de Mensajería: sus tablas, el outbox/inbox compartido y sus
 *   proveedores. No monta rutas, no importa Crédito ni Clientes, y arranca con su propia identidad
 *   de base (`atlas_ctx_messaging`), que PostgreSQL limita a su schema.
 * @system Compone a mano los providers del contexto (repositorios, orquestador, adaptadores, consumidor
 *   de eventos) sin `NotificationsModule` —que arrastra Clientes e IAM por el broadcast—, con el
 *   directorio de destinatarios REMOTO (hueco declarado) y el relay cercado por `context_ownership`.
 *   `CustomerContactMethodModel` sigue registrado porque el repositorio lo inyecta (deuda AT-061):
 *   nunca se consulta con el directorio remoto, y el rol no podría leerlo.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { LifecycleModule } from '../common/lifecycle/lifecycle.module.js';
import { ObservabilityModule } from '../common/observability/observability.module.js';
import { RedisModule } from '../common/redis/redis.module.js';
import { ResilienceModule } from '../common/resilience/resilience.module.js';
import { buildMessagingSequelizeOptions } from '../config/database.config.js';
import { ContextOwnershipModel, CustomerContactMethodModel, InboxReceiptModel, OutboxEventModel } from '../database/models/index.js';
import { EmailNotificationAdapter } from '../modules/notifications/adapters/email.adapter.js';
import { GmailMailModule } from '../modules/notifications/adapters/gmail/gmail-mail.module.js';
import { InAppNotificationAdapter } from '../modules/notifications/adapters/in-app-notification.adapter.js';
import { PushNotificationAdapter } from '../modules/notifications/adapters/push.adapter.js';
import { SmsNotificationAdapter } from '../modules/notifications/adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from '../modules/notifications/adapters/whatsapp.adapter.js';
import { RECIPIENT_DIRECTORY_PORT } from '../modules/notifications/application/ports/recipient-directory.port.js';
import { LocalRecipientDirectoryAdapter } from '../modules/notifications/infrastructure/directory/local-recipient-directory.adapter.js';
import { RemoteRecipientDirectoryAdapter } from '../modules/notifications/infrastructure/directory/remote-recipient-directory.adapter.js';
import { NotificationEventConsumer } from '../modules/notifications/infrastructure/notification-event.consumer.js';
import { NOTIFICATION_MODELS } from '../modules/notifications/infrastructure/persistence/notification-models.js';
import { NotificationOrchestratorService } from '../modules/notifications/notification-orchestrator.service.js';
import { NotificationPoliciesRepository } from '../modules/notifications/notification-policies.repository.js';
import { NotificationPreferencesRepository } from '../modules/notifications/notification-preferences.repository.js';
import { NotificationRulesService } from '../modules/notifications/notification-rules.service.js';
import { NotificationTemplateRendererService } from '../modules/notifications/notification-template-renderer.service.js';
import { NotificationTemplatesRepository } from '../modules/notifications/notification-templates.repository.js';
import { NotificationsRepository } from '../modules/notifications/notifications.repository.js';
import { EVENT_CONSUMERS } from '../platform/events/event-consumer.port.js';
import { OutboxRelayService } from '../platform/events/outbox-relay.service.js';
import { PlatformModule } from '../platform/platform.module.js';
import { MessagingDatabaseGuardService } from './messaging-database-guard.service.js';
import { MessagingRelayLoopService } from './messaging-relay-loop.service.js';

/** Modelos que el proceso registra: los de Mensajería, la infraestructura compartida y la deuda declarada. */
export const MESSAGING_WORKER_MODELS = [
  ...NOTIFICATION_MODELS,
  OutboxEventModel,
  InboxReceiptModel,
  ContextOwnershipModel,
  CustomerContactMethodModel,
];

/** Módulos que este proceso NO puede importar: si aparecen, el piloto vuelve a ser el monolito. */
export const MESSAGING_FORBIDDEN_MODULES = Object.freeze([
  'AppModule',
  'NotificationsModule',
  'CustomersModule',
  'CreditModule',
  'InternalUsersModule',
  'RuntimeJobsModule',
  'EventsModule',
]);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    LifecycleModule,
    ResilienceModule,
    ObservabilityModule,
    PlatformModule,
    SequelizeModule.forRoot({ ...buildMessagingSequelizeOptions(), models: MESSAGING_WORKER_MODELS }),
    SequelizeModule.forFeature(MESSAGING_WORKER_MODELS),
    GmailMailModule,
  ],
  providers: [
    NotificationsRepository,
    NotificationTemplatesRepository,
    NotificationPoliciesRepository,
    NotificationPreferencesRepository,
    NotificationRulesService,
    NotificationTemplateRendererService,
    NotificationOrchestratorService,
    InAppNotificationAdapter,
    EmailNotificationAdapter,
    PushNotificationAdapter,
    SmsNotificationAdapter,
    WhatsAppNotificationAdapter,
    RemoteRecipientDirectoryAdapter,
    { provide: RECIPIENT_DIRECTORY_PORT, useExisting: RemoteRecipientDirectoryAdapter },
    LocalRecipientDirectoryAdapter,
    NotificationEventConsumer,
    { provide: EVENT_CONSUMERS, useFactory: (consumer: NotificationEventConsumer) => [consumer], inject: [NotificationEventConsumer] },
    OutboxRelayService,
    MessagingDatabaseGuardService,
    MessagingRelayLoopService,
  ],
})
export class MessagingWorkerModule {}
