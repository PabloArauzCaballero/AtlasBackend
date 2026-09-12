/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UserNotificationPreferenceModel } from '../../database/models/index.js';
import { NotificationPoliciesRepository } from './notification-policies.repository.js';
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
  constructor(
    @InjectModel(UserNotificationPreferenceModel) private readonly preferenceModel: typeof UserNotificationPreferenceModel,
    private readonly policies: NotificationPoliciesRepository,
  ) {}

  async getPreferences(tenantId: string, customerId: string): Promise<UserNotificationPreferenceModel[]> {
    return this.preferenceModel.findAll({
      where: { tenantId, customerId },
      order: [
        ['eventCode', 'ASC'],
        ['channel', 'ASC'],
      ],
    });
  }

  /**
   * Guarda lo que el cliente eligió, y SÓLO lo que le corresponde elegir.
   *
   * ## El agujero que cerró
   *
   * `isRequired` llegaba en el cuerpo de la petición. Es decir: era la app de quien manda la
   * petición la que declaraba si un aviso era obligatorio. Para un cliente que nunca había tocado la
   * pantalla no existía fila previa, así que bastaba con enviar `isRequired: false` junto a
   * `isEnabled: false` para apagar el recordatorio de pago o el aviso de mora — precisamente los dos
   * que no se pueden apagar. La comprobación miraba la fila que el propio atacante acababa de
   * fabricar.
   *
   * Ahora la obligatoriedad sale del catálogo de políticas, que escribe operaciones desde el portal,
   * y el cuerpo de la petición sólo puede decir encendido o apagado. Lo que mande en `isRequired` se
   * ignora deliberadamente en lugar de rechazarse: es un campo que sobraba, no un intento de fraude,
   * y las apps ya publicadas lo siguen enviando.
   */
  async upsertPreferences(tenantId: string, customerId: string, body: UpdatePreferencesDto): Promise<UserNotificationPreferenceModel[]> {
    const now = new Date();
    const mandatory = await this.policies.mandatoryKeys(tenantId);

    for (const preference of body.preferences) {
      const isRequired = mandatory.has(`${preference.eventCode}:${preference.channel}`);
      if (isRequired && !preference.isEnabled) throw new BadRequestException('REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED');

      const existing = await this.preferenceModel.findOne({
        where: { tenantId, customerId, eventCode: preference.eventCode, channel: preference.channel },
      });

      if (existing) {
        existing.isEnabled = preference.isEnabled;
        // Se REESCRIBE con lo que dice el catálogo en vez de acumularse: si operaciones deja de
        // considerar obligatorio un aviso, la fila del cliente tiene que dejar de estar bloqueada.
        // Con el `||` anterior, un aviso marcado obligatorio una vez lo era para siempre.
        existing.isRequired = isRequired;
        existing.updatedAtValue = now;
        await existing.save();
      } else {
        await this.preferenceModel.create({
          tenantId,
          customerId,
          eventCode: preference.eventCode,
          channel: preference.channel,
          isEnabled: preference.isEnabled,
          isRequired,
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

    // El catálogo manda por encima de la fila del cliente: si operaciones declaró el aviso
    // obligatorio DESPUÉS de que alguien lo apagara, su fila dice `false` y seguiría sin avisarle.
    const policy = await this.policies.find(input.tenantId, input.eventCode, input.channel);
    if (policy?.isMandatory && policy.isActive) return true;

    const preference = await this.preferenceModel.findOne({
      where: { tenantId: input.tenantId, customerId: input.customerId, eventCode: input.eventCode, channel: input.channel },
    });
    // Sin preferencia guardada manda el valor por defecto del catálogo, y si tampoco hay política,
    // se entrega: el criterio es opt-out, y callar por falta de configuración deja al cliente sin
    // enterarse de cosas suyas.
    if (!preference) return policy ? policy.defaultEnabled : true;
    return preference.isRequired || preference.isEnabled;
  }
}
