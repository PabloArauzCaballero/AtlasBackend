/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UserNotificationPreferenceModel } from '../../database/models/index.js';
import { NotificationChannel } from './notification-types.js';
import { UpdatePreferencesDto } from './notifications.schemas.js';

/**
 * Repositorio del agregado de PREFERENCIAS de notificación del cliente (Fase 2.3 del plan 10/10).
 * Toca EXCLUSIVAMENTE `user_notification_preferences`. `NotificationsRepository` delega en él.
 *
 * Regla de negocio que vive aquí: una notificación marcada `isRequired` no se puede desactivar
 * (avisos legales/transaccionales), y ante la ausencia de preferencia el canal se considera
 * habilitado (opt-out, no opt-in).
 */
@Injectable()
export class NotificationPreferencesRepository {
  constructor(@InjectModel(UserNotificationPreferenceModel) private readonly preferenceModel: typeof UserNotificationPreferenceModel) {}

  async getPreferences(tenantId: string, customerId: string): Promise<UserNotificationPreferenceModel[]> {
    return this.preferenceModel.findAll({
      where: { tenantId, customerId },
      order: [
        ['eventCode', 'ASC'],
        ['channel', 'ASC'],
      ],
    });
  }

  async upsertPreferences(tenantId: string, customerId: string, body: UpdatePreferencesDto): Promise<UserNotificationPreferenceModel[]> {
    const now = new Date();
    for (const preference of body.preferences) {
      const existing = await this.preferenceModel.findOne({
        where: { tenantId, customerId, eventCode: preference.eventCode, channel: preference.channel },
      });
      if (existing?.isRequired && !preference.isEnabled) throw new BadRequestException('REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED');
      if (existing) {
        existing.isEnabled = preference.isEnabled;
        existing.isRequired = existing.isRequired || preference.isRequired;
        existing.updatedAtValue = now;
        await existing.save();
      } else {
        await this.preferenceModel.create({
          tenantId,
          customerId,
          eventCode: preference.eventCode,
          channel: preference.channel,
          isEnabled: preference.isEnabled,
          isRequired: preference.isRequired,
          createdAtValue: now,
          updatedAtValue: now,
        });
      }
    }
    return this.getPreferences(tenantId, customerId);
  }

  async isChannelEnabled(input: {
    tenantId: string;
    customerId: string;
    eventCode: string;
    channel: NotificationChannel;
    required?: boolean;
  }): Promise<boolean> {
    if (input.required) return true;
    const preference = await this.preferenceModel.findOne({
      where: { tenantId: input.tenantId, customerId: input.customerId, eventCode: input.eventCode, channel: input.channel },
    });
    if (!preference) return true;
    return preference.isRequired || preference.isEnabled;
  }
}
