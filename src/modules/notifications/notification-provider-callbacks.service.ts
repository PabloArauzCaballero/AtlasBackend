/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza cierra el circuito del envío: convierte el aviso del proveedor en «llegó» o «no llegó».
 * @system interpreta el callback de estado de Twilio y los eventos del webhook de SendGrid.
 */
import { Injectable, Logger } from '@nestjs/common';
import { NotificationDeliveryStatusRepository } from './notification-delivery-status.repository.js';
import { SENDGRID_ATLAS_MESSAGE_ARG } from './adapters/sendgrid/sendgrid-mail.util.js';
import { brevoSmsOutcome, sendGridBaseMessageId, sendGridOutcome, twilioOutcome } from './adapters/provider-delivery-status.util.js';

/** Los dos canales que salen por Twilio comparten el mismo callback de estado. */
const TWILIO_PROVIDERS = ['twilio_sms', 'twilio_whatsapp'] as const;
const SENDGRID_PROVIDER = 'sendgrid';
/** Los dos canales de Brevo llegan por el MISMO webhook de SMS; WhatsApp no tiene uno propio. */
const BREVO_PROVIDERS = ['brevo_sms', 'brevo_whatsapp'] as const;

export type CallbackOutcome = { applied: boolean; reason: string };

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

@Injectable()
export class NotificationProviderCallbacksService {
  private readonly logger = new Logger(NotificationProviderCallbacksService.name);

  constructor(private readonly deliveries: NotificationDeliveryStatusRepository) {}

  /**
   * Un aviso de estado de Twilio.
   *
   * Twilio manda VARIOS por mensaje (`queued`, `sent`, `delivered`) y reintenta el que no conteste
   * 2xx, así que la mayoría de las llamadas no cambian nada: eso es lo normal, no un error. Por eso
   * todas las salidas son `applied: false` con motivo y ninguna es una excepción — un 5xx aquí hace
   * que Twilio reintente en bucle un aviso que nunca vamos a poder aplicar.
   */
  async applyTwilioStatus(params: Record<string, string>): Promise<CallbackOutcome> {
    const sid = readString(params, 'MessageSid', 'SmsSid');
    if (!sid) return { applied: false, reason: 'FALTA_MESSAGE_SID' };
    const outcome = twilioOutcome(readString(params, 'MessageStatus', 'SmsStatus') ?? undefined, readString(params, 'ErrorCode'));
    if (!outcome) return { applied: false, reason: 'ESTADO_NO_TERMINAL' };

    for (const provider of TWILIO_PROVIDERS) {
      const delivery = await this.deliveries.findByProviderMessageId(provider, sid);
      if (!delivery) continue;
      const applied = await this.deliveries.applyOutcome(delivery, outcome, readString(params, 'ErrorMessage'), new Date());
      return { applied, reason: applied ? outcome.status : 'YA_TENIA_ESTADO_FINAL' };
    }
    return { applied: false, reason: 'ENTREGA_NO_ENCONTRADA' };
  }

  /**
   * Un aviso de estado de Brevo (SMS).
   *
   * Llega UNO por evento —no un lote, a diferencia de SendGrid— y Brevo manda varios por mensaje
   * (`sent`, `accepted`, `delivered`), así que la mayoría de las llamadas no cambian nada: eso es lo
   * normal. Como con Twilio, ninguna salida es una excepción: un 5xx aquí sólo consigue que Brevo
   * reintente en bucle un aviso que nunca vamos a poder aplicar.
   */
  async applyBrevoSmsEvent(body: Record<string, unknown>): Promise<CallbackOutcome> {
    const messageId = readString(body, 'messageId', 'message_id');
    if (!messageId) return { applied: false, reason: 'FALTA_MESSAGE_ID' };
    const outcome = brevoSmsOutcome(readString(body, 'msg_status') ?? undefined, readString(body, 'error_code'));
    if (!outcome) return { applied: false, reason: 'ESTADO_NO_TERMINAL' };

    for (const provider of BREVO_PROVIDERS) {
      const delivery = await this.deliveries.findByProviderMessageId(provider, messageId);
      if (!delivery) continue;
      const applied = await this.deliveries.applyOutcome(delivery, outcome, readString(body, 'description', 'reason'), new Date());
      return { applied, reason: applied ? outcome.status : 'YA_TENIA_ESTADO_FINAL' };
    }
    return { applied: false, reason: 'ENTREGA_NO_ENCONTRADA' };
  }

  /**
   * El lote de eventos de SendGrid.
   *
   * Llegan agrupados y desordenados, con eventos que no hablan de la entrega (`open`, `click`,
   * `processed`). Se procesa el lote entero y se cuenta cuántos cambiaron algo: contestar 2xx aunque
   * ninguno aplique es deliberado, porque un no-2xx hace que SendGrid reintente el lote COMPLETO,
   * incluidos los eventos que ya se aplicaron.
   */
  async applySendGridEvents(events: unknown[]): Promise<{ received: number; applied: number }> {
    let applied = 0;
    for (const raw of events) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      if (await this.applySendGridEvent(raw as Record<string, unknown>)) applied += 1;
    }
    return { received: events.length, applied };
  }

  private async applySendGridEvent(event: Record<string, unknown>): Promise<boolean> {
    const outcome = sendGridOutcome(readString(event, 'event') ?? undefined);
    if (!outcome) return false;

    const delivery = await this.findSendGridDelivery(event);
    if (!delivery) {
      // Sin ruido de PII: el correo del destinatario no entra en el log (regla de privacidad del
      // backend). El identificador del proveedor basta para rastrearlo en el panel de SendGrid.
      this.logger.debug(`Evento de SendGrid sin entrega asociada (sg_message_id=${readString(event, 'sg_message_id') ?? 'n/d'}).`);
      return false;
    }
    const motivo = readString(event, 'reason', 'response', 'status');
    return this.deliveries.applyOutcome(delivery, outcome, motivo, new Date());
  }

  /**
   * Primero por el identificador de ATLAS que viaja en `custom_args`, y sólo si no está, por el del
   * proveedor: el primero es exacto y el segundo obliga a deshacer la decoración de `sg_message_id`.
   */
  private async findSendGridDelivery(event: Record<string, unknown>) {
    const atlasMessageId = readString(event, SENDGRID_ATLAS_MESSAGE_ARG);
    if (atlasMessageId && /^[0-9]+$/u.test(atlasMessageId)) {
      const porMensaje = await this.deliveries.findLatestByMessageId(SENDGRID_PROVIDER, atlasMessageId);
      if (porMensaje) return porMensaje;
    }
    const baseMessageId = sendGridBaseMessageId(event.sg_message_id);
    if (!baseMessageId) return null;
    return this.deliveries.findByProviderMessageId(SENDGRID_PROVIDER, baseMessageId);
  }
}
