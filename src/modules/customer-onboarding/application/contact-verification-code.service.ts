/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { env } from '../../../config/env.js';
import { decryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { generateNumericCode, hashOneTimeCode, verifyOneTimeCode } from '../../../common/utils/crypto/one-time-code.util.js';
import { CustomerContactMethodModel } from '../../../database/models/index.js';
import { AuthRepository, OneTimeCodePurpose } from '../../auth/auth.repository.js';
import { AuthOneTimeCodeRepository } from '../../auth/auth-one-time-code.repository.js';
import { MailSenderService } from '../../mail-sender/mail-sender.service.js';
import { NotificationChannelAdapter } from '../../notifications/adapters/notification-channel-adapter.js';
import { SmsNotificationAdapter } from '../../notifications/adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from '../../notifications/adapters/whatsapp.adapter.js';

export type ContactType = 'phone' | 'email';
export type VerificationChannel = 'sms' | 'email' | 'whatsapp';

export type CodeDeliveryOutcome = {
  delivered: boolean;
  provider: string;
  errorCode: string | null;
};

/** Código ya persistido (solo su hash) más lo que hace falta para entregarlo tras el commit. */
export type IssuedCode = {
  code: string;
  ttlMinutes: number;
  destination: string | null;
};

/** Un propósito por tipo de contacto: pedir el código del correo no debe invalidar el del teléfono. */
export function purposeFor(contactType: ContactType): OneTimeCodePurpose {
  return contactType === 'phone' ? 'contact_verification_phone' : 'contact_verification_email';
}

/**
 * Emisión, entrega y verificación del código de verificación de contacto (OTP).
 *
 * Reemplaza el placeholder que aceptaba el literal `'123456'`. Ese atajo llegó a estar activo en
 * cualquier ambiente —una auditoría previa lo encontró y lo bloqueó en producción con un 422—, de
 * modo que hasta ahora el onboarding simplemente no podía completarse fuera de desarrollo.
 *
 * El código ahora:
 *  - se genera con `randomInt` y solo se persiste su hash SHA-256 (`auth_one_time_codes`), igual que
 *    el PIN de login y el código de reset: el valor en claro viaja una sola vez y no es
 *    reconstruible desde la base de datos;
 *  - vence según `AUTH_ONE_TIME_CODE_TTL_MINUTES` y se consume al primer uso correcto;
 *  - agota intentos según `AUTH_ONE_TIME_CODE_MAX_ATTEMPTS`, tras lo cual ni el código correcto sirve;
 *  - se entrega por el canal que el cliente eligió, con los adaptadores que el módulo
 *    `notifications` ya tenía implementados y que nadie había cableado a este flujo.
 */
@Injectable()
export class ContactVerificationCodeService {
  private readonly logger = new Logger(ContactVerificationCodeService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly oneTimeCodeRepository: AuthOneTimeCodeRepository,
    private readonly mailSenderService: MailSenderService,
    private readonly smsAdapter: SmsNotificationAdapter,
    private readonly whatsappAdapter: WhatsAppNotificationAdapter,
  ) {}

  /** Canales realmente utilizables con la configuración vigente. */
  availableChannels(): VerificationChannel[] {
    const channels: VerificationChannel[] = [];
    if (this.mailSenderService.isEnabled()) channels.push('email');
    if (this.smsAdapter.getProviderName() !== 'disabled') channels.push('sms');
    if (this.whatsappAdapter.getProviderName() !== 'disabled') channels.push('whatsapp');
    return channels;
  }

  assertChannelAvailable(channel: VerificationChannel): void {
    if (!this.availableChannels().includes(channel)) {
      // Falla ruidosamente en vez de registrar un intento que nunca llegará a destino: un cliente
      // esperando un código que no se envió es indistinguible de un código perdido.
      throw new ServiceUnavailableException(`VERIFICATION_CHANNEL_UNAVAILABLE: ${channel}`);
    }
  }

  /**
   * Emite el código DENTRO de la transacción del llamador y devuelve lo necesario para entregarlo
   * después del commit.
   *
   * La emisión y la entrega están separadas a propósito. Antes iban juntas y el código se creaba
   * fuera de la transacción del flujo: si el resto hacía rollback quedaba un código vigente sin
   * intento asociado, y el `submit` posterior respondía `VERIFICATION_ATTEMPT_NOT_FOUND` sobre un
   * código que el cliente sí tenía en la mano. Al revés tampoco vale: entregar dentro de la
   * transacción mantiene locks abiertos durante toda la latencia del proveedor, y un mensaje ya
   * enviado no se puede deshacer si la transacción falla después.
   */
  async issue(input: {
    tenantId: string;
    customerId: string;
    contactMethod: CustomerContactMethodModel;
    contactType: ContactType;
    transaction?: Transaction;
  }): Promise<IssuedCode> {
    const code = generateNumericCode();
    const ttlMinutes = env.AUTH_ONE_TIME_CODE_TTL_MINUTES;

    await this.oneTimeCodeRepository.createOneTimeCode(
      {
        tenantId: input.tenantId,
        actorType: 'customer',
        actorId: input.customerId,
        purpose: purposeFor(input.contactType),
        codeHash: hashOneTimeCode(code),
        challengeHash: null,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
      { transaction: input.transaction },
    );

    return { code, ttlMinutes, destination: await this.resolveDestination(input.contactMethod) };
  }

  /**
   * Entrega un código ya emitido. Se llama DESPUÉS del commit. NO lanza si el proveedor falla: el
   * intento ya quedó registrado y el resultado se refleja en su estado.
   */
  async deliverIssuedCode(input: {
    tenantId: string;
    customerId: string;
    channel: VerificationChannel;
    issued: IssuedCode;
  }): Promise<CodeDeliveryOutcome> {
    if (!input.issued.destination) {
      return { delivered: false, provider: 'none', errorCode: 'CONTACT_VALUE_UNREADABLE' };
    }

    return this.deliver({
      channel: input.channel,
      destination: input.issued.destination,
      code: input.issued.code,
      ttlMinutes: input.issued.ttlMinutes,
      tenantId: input.tenantId,
      customerId: input.customerId,
    });
  }

  /**
   * Valida el código enviado por el cliente.
   *
   * Devuelve un motivo tipado en vez de lanzar, para que el servicio llamante escriba el intento
   * fallido y su evento de auditoría antes de traducirlo a la excepción HTTP correspondiente.
   */
  async verify(input: {
    customerId: string;
    contactType: ContactType;
    candidate: string;
  }): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'expired' | 'invalid' }> {
    const record = await this.oneTimeCodeRepository.findActiveOneTimeCodeByActor(
      'customer',
      input.customerId,
      purposeFor(input.contactType),
    );
    if (!record) return { ok: false, reason: 'not_found' };

    if (record.expiresAt.getTime() < Date.now()) {
      await this.oneTimeCodeRepository.consumeOneTimeCode(record);
      return { ok: false, reason: 'expired' };
    }

    if (!verifyOneTimeCode(input.candidate, record.codeHash)) {
      await this.oneTimeCodeRepository.registerOneTimeCodeFailedAttempt(record, env.AUTH_ONE_TIME_CODE_MAX_ATTEMPTS);
      return { ok: false, reason: 'invalid' };
    }

    await this.oneTimeCodeRepository.consumeOneTimeCode(record);
    return { ok: true };
  }

  /**
   * Recupera el valor en claro del contacto desde el sobre cifrado.
   *
   * Es la única lectura en claro de este dato en todo el flujo, y existe porque no hay otra forma de
   * entregarle un mensaje al cliente. Un sobre ilegible degrada a `null`; nunca tumba la operación.
   */
  private async resolveDestination(contactMethod: CustomerContactMethodModel): Promise<string | null> {
    if (!contactMethod.contactValueEncrypted) return null;
    try {
      return await decryptSecretEnvelope(contactMethod.contactValueEncrypted);
    } catch (error) {
      this.logger.error(`No se pudo descifrar el contacto ${contactMethod.id} para entregar el código: ${(error as Error).message}`);
      return null;
    }
  }

  private async deliver(input: {
    channel: VerificationChannel;
    destination: string;
    code: string;
    ttlMinutes: number;
    tenantId: string;
    customerId: string;
  }): Promise<CodeDeliveryOutcome> {
    const reference = `contact-verification:${input.customerId}`;
    try {
      if (input.channel === 'email') {
        await this.mailSenderService.sendContactVerificationCode({
          to: input.destination,
          code: input.code,
          ttlMinutes: input.ttlMinutes,
          reference,
        });
        return { delivered: true, provider: 'mailsender', errorCode: null };
      }

      const adapter: NotificationChannelAdapter = input.channel === 'sms' ? this.smsAdapter : this.whatsappAdapter;
      // Mensaje efímero: no se persiste en `notification_messages` porque su cuerpo contiene el
      // código en claro, y esa tabla es consultable desde el portal interno.
      const result = await adapter.send({
        id: reference,
        tenantId: input.tenantId,
        recipientType: 'customer',
        recipientId: input.customerId,
        channel: input.channel,
        subject: null,
        title: 'ATLAS',
        body: `Tu código de verificación ATLAS es ${input.code}. Vence en ${input.ttlMinutes} minutos.`,
        payload: { reference },
        correlationId: null,
        deliveryTargets: [{ address: input.destination, kind: input.channel === 'sms' ? 'phone' : 'whatsapp' }],
      });
      return {
        delivered: result.status === 'sent' || result.status === 'delivered',
        provider: result.provider,
        errorCode: result.errorCode ?? null,
      };
    } catch (error) {
      // El código ya quedó emitido y vigente: si el proveedor falla, el cliente puede reintentar el
      // envío pasado el cooldown. Se registra el motivo sin exponerlo al cliente.
      this.logger.error(`Fallo entregando el código de verificación por ${input.channel}: ${(error as Error).message}`);
      return { delivered: false, provider: input.channel, errorCode: 'DELIVERY_FAILED' };
    }
  }
}
