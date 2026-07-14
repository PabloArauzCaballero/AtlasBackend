import { Injectable } from '@nestjs/common';
import { MailSenderClient } from './mail-sender.client.js';

const FALLBACK_RECIPIENT_NAME = 'Usuario ATLAS';

/**
 * Fachada de dominio sobre `MailSenderClient`: expone los tres correos transaccionales que ATLAS
 * envía hoy (código de reset de contraseña, PIN de login de administradores y credenciales
 * iniciales de usuarios nuevos) sin que los módulos llamantes conozcan plantillas ni contrato HTTP.
 */
@Injectable()
export class MailSenderService {
  constructor(private readonly client: MailSenderClient) {}

  isEnabled(): boolean {
    return this.client.isConfigured();
  }

  async sendPasswordResetCode(input: {
    to: string;
    recipientName: string | null;
    code: string;
    ttlMinutes: number;
    reference: string;
  }): Promise<{ trackingId: string }> {
    return this.client.sendTemplateEmail({
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

  async sendLoginPin(input: {
    to: string;
    recipientName: string | null;
    pin: string;
    ttlMinutes: number;
    reference: string;
  }): Promise<{ trackingId: string }> {
    return this.client.sendTemplateEmail({
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
    return this.client.sendTemplateEmail({
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
