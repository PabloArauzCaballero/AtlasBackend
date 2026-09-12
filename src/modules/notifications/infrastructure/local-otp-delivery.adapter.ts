/**
 * @file Adaptador local del puerto de entrega de OTP (AT-040).
 * @business Misma entrega que hacía el servicio de verificación de contactos, ahora detrás del contrato:
 *   vencido → no se entrega; canal apagado → error explícito; timeout del proveedor → incierto.
 * @system Envuelve `MailSenderService` y los adaptadores SMS/WhatsApp. Un error cuyo mensaje delate
 *   timeout/abort se clasifica como incierto (el proveedor pudo haber aceptado).
 */
import { Injectable } from '@nestjs/common';
import { MailSenderService } from '../../mail-sender/mail-sender.service.js';
import type { NotificationChannelAdapter } from '../adapters/notification-channel-adapter.js';
import { SmsNotificationAdapter } from '../adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from '../adapters/whatsapp.adapter.js';
import {
  OTP_ERRORS,
  type ChannelCapability,
  type OtpDeliveryOutcome,
  type OtpDeliveryPort,
  type OtpDeliveryRequest,
} from '../application/ports/otp-delivery.port.js';

const UNCERTAIN_PATTERN = /timeout|timed out|abort|ETIMEDOUT|ECONNRESET|socket hang up/i;

export function classifyDeliveryError(error: unknown): { errorCode: string; uncertain: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  return UNCERTAIN_PATTERN.test(message)
    ? { errorCode: OTP_ERRORS.uncertain, uncertain: true }
    : { errorCode: OTP_ERRORS.failed, uncertain: false };
}

@Injectable()
export class LocalOtpDeliveryAdapter implements OtpDeliveryPort {
  constructor(
    private readonly mail: MailSenderService,
    private readonly sms: SmsNotificationAdapter,
    private readonly whatsapp: WhatsAppNotificationAdapter,
  ) {}

  capabilities(): readonly ChannelCapability[] {
    return Object.freeze([
      { channel: 'email', available: this.mail.isEnabled(), idempotentByReference: false, provider: 'mailsender' },
      {
        channel: 'sms',
        available: this.sms.getProviderName() !== 'disabled',
        idempotentByReference: true,
        provider: this.sms.getProviderName(),
      },
      {
        channel: 'whatsapp',
        available: this.whatsapp.getProviderName() !== 'disabled',
        idempotentByReference: true,
        provider: this.whatsapp.getProviderName(),
      },
    ]);
  }

  async deliver(request: OtpDeliveryRequest): Promise<OtpDeliveryOutcome> {
    const now = request.now ?? new Date();
    if (request.expiresAt.getTime() <= now.getTime())
      return { delivered: false, provider: 'none', errorCode: OTP_ERRORS.expired, uncertain: false };
    const capability = this.capabilities().find((entry) => entry.channel === request.channel);
    if (!capability || !capability.available)
      return { delivered: false, provider: capability?.provider ?? 'none', errorCode: OTP_ERRORS.unsupported, uncertain: false };
    try {
      if (request.channel === 'email') {
        await this.mail.sendContactVerificationCode({
          to: request.destination,
          code: request.code,
          ttlMinutes: request.ttlMinutes,
          reference: request.reference,
        });
        return { delivered: true, provider: 'mailsender', errorCode: null, uncertain: false };
      }
      const adapter: NotificationChannelAdapter = request.channel === 'sms' ? this.sms : this.whatsapp;
      const result = await adapter.send({
        id: request.reference,
        tenantId: request.tenantId,
        recipientType: 'customer',
        recipientId: request.customerId,
        channel: request.channel,
        subject: null,
        title: 'ATLAS',
        body: `Tu código de verificación ATLAS es ${request.code}. Vence en ${request.ttlMinutes} minutos.`,
        payload: { reference: request.reference },
        correlationId: null,
        deliveryTargets: [{ address: request.destination, kind: request.channel === 'sms' ? 'phone' : 'whatsapp' }],
      });
      const delivered = result.status === 'sent' || result.status === 'delivered';
      return {
        delivered,
        provider: result.provider,
        errorCode: delivered ? null : (result.errorCode ?? OTP_ERRORS.failed),
        uncertain: false,
      };
    } catch (error) {
      const classified = classifyDeliveryError(error);
      return { delivered: false, provider: capability.provider, errorCode: classified.errorCode, uncertain: classified.uncertain };
    }
  }
}
