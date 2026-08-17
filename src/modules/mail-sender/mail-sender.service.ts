/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.
 * @system encapsula el cliente HTTP de correo y sus plantillas, timeouts y errores tipados.
 */
import { Injectable } from '@nestjs/common';
import { GmailMailTransport } from './gmail-mail.transport.js';
import { WebhookMailTransport } from './webhook-mail.transport.js';
import { MailSenderClient, SendTemplateEmailInput } from './mail-sender.client.js';

const FALLBACK_RECIPIENT_NAME = 'Usuario ATLAS';

/**
 * Fachada de dominio del correo transaccional: expone los cuatro correos que ATLAS envía hoy
 * (código de reset de contraseña, PIN de login, verificación de contacto y credenciales iniciales)
 * sin que los módulos llamantes conozcan plantillas, transporte ni contrato HTTP.
 *
 * Conserva el nombre `MailSenderService` porque MailSender sigue siendo el canal PREFERENTE —el que
 * hospeda las plantillas, registra el envío y permite editarlas en caliente—, pero ya no es el
 * único: si no está configurado, el correo sale por el proveedor que el entorno haya elegido
 * (Gmail, o un webhook para los buzones de desarrollo). Antes esa ausencia apagaba en silencio el
 * segundo factor de los actores internos, y un despliegue con correo perfectamente sano se quedaba
 * con un solo factor.
 */
@Injectable()
export class MailSenderService {
  constructor(
    private readonly client: MailSenderClient,
    private readonly gmail: GmailMailTransport,
    private readonly webhook: WebhookMailTransport,
  ) {}

  /** ¿Hay ALGÚN canal por el que entregar un correo transaccional? */
  isEnabled(): boolean {
    return this.client.isConfigured() || this.gmail.isConfigured() || this.webhook.isConfigured();
  }

  /** MailSender manda cuando está; los otros son suplentes, y son excluyentes entre sí. */
  private deliver(input: SendTemplateEmailInput): Promise<{ trackingId: string }> {
    if (this.client.isConfigured()) return this.client.sendTemplateEmail(input);
    if (this.gmail.isConfigured()) return this.gmail.sendTemplateEmail(input);
    return this.webhook.sendTemplateEmail(input);
  }

  async sendPasswordResetCode(input: {
    to: string;
    recipientName: string | null;
    code: string;
    ttlMinutes: number;
    reference: string;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-password-reset',
      to: input.to,
      recipientName: input.recipientName,
      sourceModule: 'auth',
      reference: input.reference,
      variables: {
        nombre: input.recipientName ?? FALLBACK_RECIPIENT_NAME,
        codigo: input.code,
        minutos: String(input.ttlMinutes),
      },
    });
  }

  /** Código de verificación del correo declarado por un cliente durante el onboarding. */
  async sendContactVerificationCode(input: {
    to: string;
    code: string;
    ttlMinutes: number;
    reference: string;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-verificacion-contacto',
      to: input.to,
      recipientName: null,
      sourceModule: 'customer-onboarding',
      reference: input.reference,
      variables: { codigo: input.code, minutos: String(input.ttlMinutes) },
    });
  }

  async sendLoginPin(input: {
    to: string;
    recipientName: string | null;
    pin: string;
    ttlMinutes: number;
    reference: string;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-login-pin',
      to: input.to,
      recipientName: input.recipientName,
      sourceModule: 'auth',
      reference: input.reference,
      variables: {
        nombre: input.recipientName ?? FALLBACK_RECIPIENT_NAME,
        pin: input.pin,
        minutos: String(input.ttlMinutes),
      },
    });
  }

  async sendInitialCredentials(input: {
    to: string;
    recipientName: string | null;
    temporaryPassword: string;
    reference: string;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-credenciales-iniciales',
      to: input.to,
      recipientName: input.recipientName,
      sourceModule: 'internal-users',
      reference: input.reference,
      variables: {
        nombre: input.recipientName ?? FALLBACK_RECIPIENT_NAME,
        email: input.to,
        password: input.temporaryPassword,
      },
    });
  }
}
