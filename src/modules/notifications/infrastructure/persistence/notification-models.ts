/**
 * @file Registro de modelos propios del contexto Mensajería (AT-018).
 * @business Mensajería es dueña de plantillas, políticas, mensajes, entregas, preferencias, tokens de
 *   canal y campañas. Los contactos del cliente y el tenant NO son suyos: los lee por contrato (AT-039).
 * @system Lo agrega `database-models.ts`; el piloto de extracción (F9) arranca sólo con esta lista.
 */
import {
  DeviceTokenModel,
  NotificationAudienceSegmentModel,
  NotificationCampaignModel,
  NotificationDeliveryModel,
  NotificationMessageModel,
  NotificationPolicyModel,
  NotificationTemplateModel,
  UserNotificationPreferenceModel,
} from '../../../../database/models/index.js';

export const NOTIFICATION_MODELS = [
  NotificationTemplateModel,
  NotificationPolicyModel,
  NotificationMessageModel,
  NotificationDeliveryModel,
  UserNotificationPreferenceModel,
  DeviceTokenModel,
  NotificationCampaignModel,
  NotificationAudienceSegmentModel,
] as const;
