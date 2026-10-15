/**
 * @file Servicio de aplicación: pantalla de avisos del cliente (catálogo de políticas + elección guardada).
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { NotificationPoliciesRepository } from './notification-policies.repository.js';
import { NotificationPreferencesRepository } from './notification-preferences.repository.js';
import { POLICY_EVENT_CODES_WITHOUT_SENDER } from './notification-rules.service.js';
import { UpdatePreferencesDto } from './notifications.schemas.js';
import { mapPreference } from './notifications.mapper.js';

@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly preferences: NotificationPreferencesRepository,
    private readonly policies: NotificationPoliciesRepository,
  ) {}

  /**
   * La pantalla de avisos del cliente, entera.
   *
   * ## Por qué devuelve el catálogo y no sólo lo guardado
   *
   * Porque antes devolvía únicamente las filas que el cliente ya había escrito, y quien nunca había
   * tocado la pantalla no tenía ninguna: la app recibía una lista vacía y pintaba una pantalla de
   * preferencias sin ninguna preferencia. No es que estuviera mal configurada — es que no había
   * NADA que configurar hasta que alguien configurara algo, que es un círculo del que no se sale.
   *
   * Ahora la lista sale del catálogo de políticas, que es la respuesta a «qué avisos existen», y la
   * elección del cliente se superpone encima. Sin elección guardada manda el valor por defecto de la
   * política, no un hueco.
   *
   * ## Y por qué viaja la etiqueta y el motivo
   *
   * Para que la app no tenga que traducir códigos internos. Con los textos en el servidor, añadir un
   * aviso nuevo o reescribir una explicación que se entiende mal no exige publicar en las tiendas. Y
   * el candado de los obligatorios viaja con su motivo: un interruptor bloqueado sin explicación se
   * lee como abuso, y aquí el motivo es exactamente lo que justifica el bloqueo.
   */
  async getPreferences(tenantId: string, customerId: string) {
    const [policies, saved] = await Promise.all([
      this.policies.listActive(tenantId),
      this.preferences.getPreferences(tenantId, customerId),
    ]);

    const chosen = new Map(saved.map((preference) => [`${preference.eventCode}:${preference.channel}`, preference]));

    // Un interruptor para un aviso que nadie envía es una promesa falsa: la mora y el vencimiento no se
    // avisan al deudor (decisión de producto pendiente), así que su política no se ofrece en la pantalla.
    const offered = policies.filter((policy) => !POLICY_EVENT_CODES_WITHOUT_SENDER.includes(policy.eventCode));

    const data = offered.map((policy) => {
      const preference = chosen.get(`${policy.eventCode}:${policy.channel}`);
      return {
        eventCode: policy.eventCode,
        channel: policy.channel,
        label: policy.label,
        description: policy.description,
        category: policy.category,
        icon: policy.icon,
        isMandatory: policy.isMandatory,
        mandatoryReason: policy.mandatoryReason,
        isEnabled: policy.isMandatory ? true : (preference?.isEnabled ?? policy.defaultEnabled),
        // `true` sólo cuando el cliente lo eligió: la app distingue «lo dejaste así» de «viene así».
        isExplicit: Boolean(preference),
        displayOrder: policy.displayOrder,
      };
    });

    /*
     * Las preferencias guardadas para avisos que YA NO están en el catálogo no se enseñan, pero
     * tampoco se borran: si operaciones desactiva una política y luego la vuelve a activar, la
     * elección que el cliente había hecho sigue ahí y se respeta. Borrarlas convertiría un cambio de
     * configuración en una pérdida silenciosa de la voluntad de la persona.
     */
    return {
      data,
      legacy: saved
        .filter(
          (preference) => !policies.some((policy) => policy.eventCode === preference.eventCode && policy.channel === preference.channel),
        )
        .map(mapPreference),
    };
  }

  async updatePreferences(tenantId: string, customerId: string, body: UpdatePreferencesDto) {
    await this.preferences.upsertPreferences(tenantId, customerId, body);
    // Se devuelve la MISMA forma que la lectura: la app repinta con la respuesta y, si aquí faltara
    // la etiqueta o el candado, la pantalla se quedaría en blanco justo después de guardar.
    return this.getPreferences(tenantId, customerId);
  }
}
