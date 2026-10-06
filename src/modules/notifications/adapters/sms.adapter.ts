/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { DeliveryResult, NotificationChannel, NotificationMessagePayload } from '../notification-types.js';
import { failedDelivery, getFirstDeliveryTarget, getJson, postForm, postJson, sentDelivery } from './http-adapter.util.js';
import { NotificationChannelAdapter } from './notification-channel-adapter.js';
import { NotificationProviderConfigService } from './notification-provider-config.service.js';
import { toE164, twilioAuthHeader, twilioErrorDetails } from './twilio/twilio-request.util.js';
import { twilioOutcome } from './provider-delivery-status.util.js';
import { BREVO_API_BASE, brevoAuthHeader, brevoErrorDetails, brevoMessageId, toBrevoNumber } from './brevo/brevo-request.util.js';
import { BrevoSmsCreditCache, smsCreditFromAccount, type BrevoSmsCredit } from './brevo/brevo-sms-credit.util.js';

@Injectable()
export class SmsNotificationAdapter implements NotificationChannelAdapter {
  private readonly brevoCredit = new BrevoSmsCreditCache();

  /** Cuánto se espera antes de preguntarle a Twilio cómo quedó el mensaje (ver `confirmTwilioDelivery`). */
  protected confirmDelayMs = 1200;

  constructor(
    private readonly config: NotificationProviderConfigService,
    private readonly executor: ResilientAdapterExecutorService,
  ) {}

  getProviderName(): string {
    return this.config.getSmsProvider();
  }

  supports(channel: NotificationChannel): boolean {
    return channel === 'sms';
  }

  validatePayload(message: NotificationMessagePayload): boolean {
    return message.channel === 'sms' && Boolean(message.body);
  }

  async send(message: NotificationMessagePayload): Promise<DeliveryResult> {
    const provider = this.config.getSmsProvider();
    if (provider === 'disabled') return failedDelivery('disabled_sms', 'SMS_PROVIDER_DISABLED', 'No hay proveedor SMS configurado.');
    const to = getFirstDeliveryTarget(message, 'phone');
    if (!to) return failedDelivery(provider, 'MISSING_SMS_RECIPIENT', 'El payload no contiene phone, toPhone, recipientPhone ni smsTo.');
    if (provider === 'webhook') return this.sendWebhook(message, to);
    if (provider === 'brevo') return this.sendBrevo(message, to);
    if (provider !== 'twilio') return failedDelivery(provider, 'UNSUPPORTED_SMS_PROVIDER', `Proveedor SMS no soportado: ${provider}`);
    return this.sendTwilio(message, to);
  }

  private async sendTwilio(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const config = this.config.getTwilioSmsConfig();
    if (!config.ok) return failedDelivery('twilio_sms', config.missing, `Falta configuración de Twilio: ${config.missing}.`);
    const destino = toE164(to, config.value.defaultCountryCode);
    if (!destino) return failedDelivery('twilio_sms', 'INVALID_SMS_RECIPIENT', `El destinatario "${to}" no tiene forma de teléfono.`);

    const response = await postForm(
      this.executor,
      'twilio_sms',
      `https://api.twilio.com/2010-04-01/Accounts/${config.value.accountSid}/Messages.json`,
      twilioAuthHeader(config.value.accountSid, config.value.authToken),
      {
        To: destino,
        ...config.value.sender,
        Body: message.body,
        // Twilio contesta `queued` y sólo después sabe si el operador entregó. Sin esta URL el
        // estado se queda en «enviado» para siempre y un número apagado se ve igual que uno que
        // recibió: el callback es lo único que distingue los dos.
        ...(config.value.statusCallbackUrl ? { StatusCallback: config.value.statusCallbackUrl } : {}),
      },
    );
    if (!response.ok) return this.twilioFailure(response.status, response.json);
    const sid = typeof response.json.sid === 'string' ? response.json.sid : null;
    const early = twilioOutcome(typeof response.json.status === 'string' ? response.json.status : undefined, twilioCode(response.json));
    if (early?.status === 'failed')
      return failedDelivery('twilio_sms', early.errorCode ?? 'TWILIO_SMS_UNDELIVERED', 'Twilio no pudo enviar el SMS.', response.json);
    if (sid && message.payload?.confirmDelivery === true) {
      const confirmed = await this.confirmTwilioDelivery(config.value, sid);
      if (confirmed) return confirmed;
    }
    return sentDelivery('twilio_sms', sid, response.json);
  }

  /**
   * Pregunta a Twilio cómo quedó un mensaje que acaba de aceptar, y sólo para los que lo piden.
   *
   * Twilio contesta `201 queued` a TODO: también al SMS que va a fallar un instante después (medido
   * en TEST el 2026-10-06: seis códigos del alta a Bolivia, `201`, y `failed 21704` en el mismo
   * segundo). Sin esta pregunta el código de verificación se daba por entregado, la reserva por
   * correo —que sólo actúa cuando el envío falló— nunca entraba, y la persona se quedaba esperando
   * un SMS que no existía. Sólo se pregunta para el código del alta: es lo único donde esperar un
   * segundo evita dejar a alguien sin poder continuar; el resto de mensajes sigue sin esa espera.
   *
   * Si la pregunta misma falla, no se condena el envío: devuelve `null` y se da por aceptado.
   */
  private async confirmTwilioDelivery(config: { accountSid: string; authToken: string }, sid: string): Promise<DeliveryResult | null> {
    if (this.confirmDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.confirmDelayMs));
    const status = await getJson(
      this.executor,
      'twilio_sms',
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages/${sid}.json`,
      twilioAuthHeader(config.accountSid, config.authToken),
    );
    if (!status.ok) return null;
    const outcome = twilioOutcome(typeof status.json.status === 'string' ? status.json.status : undefined, twilioCode(status.json));
    if (outcome?.status !== 'failed') return null;
    return failedDelivery(
      'twilio_sms',
      outcome.errorCode ?? 'TWILIO_SMS_UNDELIVERED',
      'Twilio aceptó el SMS y lo marcó como no enviado.',
      status.json,
    );
  }

  /**
   * Un fallo de Twilio, con su motivo REAL.
   *
   * El código propio se separa en dos porque las consecuencias son distintas: `RECIPIENT_REJECTED`
   * dice que ese número no va a recibir por más que se insista —hay que corregirlo o darlo de baja—
   * mientras que `SEND_FAILED` es un problema del envío que puede volver a intentarse.
   */
  private twilioFailure(status: number, body: Record<string, unknown>): DeliveryResult {
    const detalle = twilioErrorDetails(body);
    const sufijo = detalle.code ? ` (Twilio ${detalle.code}: ${detalle.message ?? 'sin detalle'})` : '';
    if (detalle.permanent)
      return failedDelivery('twilio_sms', 'TWILIO_SMS_RECIPIENT_REJECTED', `Twilio rechazó el destinatario${sufijo}.`, body);
    return failedDelivery('twilio_sms', 'TWILIO_SMS_SEND_FAILED', `Twilio respondió HTTP ${status}.${sufijo}`, body);
  }

  /**
   * Un SMS por Brevo.
   *
   * Dos diferencias con Twilio que no se ven en la firma y cuestan una tarde cada una: el
   * destinatario va SIN `+` (`59170000000`) y la URL de estado viaja en el propio envío (`webUrl`)
   * en vez de registrarse en el panel. Lo segundo es deliberado: así cada despliegue apunta a su
   * entorno sin que dev pise los avisos de test, que es justo lo que pasa con un webhook por cuenta.
   */
  private async sendBrevo(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const config = this.config.getBrevoSmsConfig();
    if (!config.ok) return failedDelivery('brevo_sms', config.missing, `Falta configuración de Brevo: ${config.missing}.`);
    const destino = toBrevoNumber(to, config.value.defaultCountryCode);
    if (!destino) return failedDelivery('brevo_sms', 'INVALID_SMS_RECIPIENT', `El destinatario "${to}" no tiene forma de teléfono.`);

    // Sin saldo SMS, Brevo contesta 201 y tira el mensaje: hay que parar ANTES de creerle (ver
    // `brevo-sms-credit.util.ts`). Sólo se bloquea cuando el saldo se pudo leer y es cero.
    const saldo = await this.brevoSmsCredit(config.value.apiKey);
    if (!saldo.canSend)
      return failedDelivery(
        'brevo_sms',
        'BREVO_SMS_NO_CREDITS',
        'La cuenta de Brevo no tiene crédito de SMS: aceptaría el envío y descartaría el mensaje.',
      );

    const response = await postJson(
      this.executor,
      'brevo_sms',
      `${BREVO_API_BASE}/transactionalSMS/send`,
      brevoAuthHeader(config.value.apiKey),
      {
        sender: config.value.sender,
        recipient: destino,
        content: message.body,
        // `transactional` y no `marketing`: un código de verificación no se manda a la cola de
        // marketing, que respeta horarios y listas de baja. Brevo cobra y enruta distinto los dos.
        type: 'transactional',
        ...(config.value.statusCallbackUrl ? { webUrl: config.value.statusCallbackUrl } : {}),
      },
    );
    if (!response.ok) return this.brevoFailure(response.status, response.json);
    return sentDelivery('brevo_sms', brevoMessageId(response.json.messageId), response.json);
  }

  /**
   * El saldo SMS de la cuenta, preguntado como mucho una vez cada diez minutos.
   *
   * Un fallo al preguntarlo NO bloquea el envío: se cachea como «no se pudo saber» y el mensaje
   * sigue su curso. Perder códigos porque Brevo tardó en contestar a una consulta de saldo sería
   * cambiar un problema silencioso por otro peor.
   */
  private async brevoSmsCredit(apiKey: string): Promise<BrevoSmsCredit> {
    const cacheado = this.brevoCredit.read();
    if (cacheado) return cacheado;
    const response = await getJson(this.executor, 'brevo_sms', `${BREVO_API_BASE}/account`, brevoAuthHeader(apiKey));
    if (!response.ok) return this.brevoCredit.write({ canSend: true, credits: null });
    return this.brevoCredit.write(smsCreditFromAccount(response.json));
  }

  /** Un fallo de Brevo, separando «ese número no va a recibir» de «vuelve a intentarlo». */
  private brevoFailure(status: number, body: Record<string, unknown>): DeliveryResult {
    const detalle = brevoErrorDetails(body);
    const sufijo = detalle.code ? ` (Brevo ${detalle.code}: ${detalle.message ?? 'sin detalle'})` : '';
    if (detalle.permanent) return failedDelivery('brevo_sms', 'BREVO_SMS_RECIPIENT_REJECTED', `Brevo rechazó el envío${sufijo}.`, body);
    return failedDelivery('brevo_sms', 'BREVO_SMS_SEND_FAILED', `Brevo respondió HTTP ${status}.${sufijo}`, body);
  }

  private async sendWebhook(message: NotificationMessagePayload, to: string): Promise<DeliveryResult> {
    const url = this.config.getWebhookUrl('sms');
    if (!url) return failedDelivery('webhook_sms', 'WEBHOOK_URL_MISSING', 'NOTIFICATION_WEBHOOK_URL no está configurado.');
    const response = await postJson(
      this.executor,
      'webhook_sms',
      url,
      {},
      { channel: 'sms', to, body: message.body, payload: message.payload, messageId: message.id },
    );
    if (!response.ok)
      return failedDelivery('webhook_sms', 'WEBHOOK_SMS_FAILED', `Webhook respondió HTTP ${response.status}.`, response.json);
    return sentDelivery('webhook_sms', String(response.json.id ?? response.json.messageId ?? message.id), response.json);
  }
}

function twilioCode(body: Record<string, unknown>): string | null {
  const code = body.error_code;
  return code === null || code === undefined ? null : String(code);
}
