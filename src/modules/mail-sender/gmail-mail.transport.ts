/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.
 * @system envía las plantillas transaccionales por la Gmail API cuando MailSender no está.
 */
import { Injectable } from '@nestjs/common';
import { GmailApiAdapter } from '../notifications/adapters/gmail/gmail.adapter.js';
import { renderMailTemplate } from './mail-template-render.js';
import { SendTemplateEmailInput } from './mail-sender.client.js';

/**
 * Segundo transporte para el correo transaccional: la Gmail API, cuando MailSender no está.
 *
 * MailSender era el único canal, y ese detalle de infraestructura decidía si existía o no el
 * segundo factor: sin `MAILSENDER_BASE_URL`, `AuthSecondFactorService.isRequired` devuelve `false` y
 * los actores internos entran con la contraseña sola. Un despliegue con un proveedor de correo
 * perfectamente sano —el que ya usa el módulo de notificaciones— se quedaba igualmente sin 2FA.
 *
 * Preferencia y no reemplazo: si MailSender está configurado, manda él (ver `MailSenderService`).
 * Esto es lo que hace que "no hay MailSender" deje de significar "no hay correo".
 */
@Injectable()
export class GmailMailTransport {
  constructor(private readonly gmail: GmailApiAdapter) {}

  /** ¿Es Gmail el proveedor de correo ELEGIDO en el entorno y tiene sus cuatro credenciales? */
  isConfigured(): boolean {
    return this.gmail.isEnabled();
  }

  async sendTemplateEmail(input: SendTemplateEmailInput): Promise<{ trackingId: string }> {
    const rendered = renderMailTemplate(input.template, { ...input.variables });
    const sent = await this.gmail.sendEmail({
      to: [input.to],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      // El identificador de la operación de negocio hace de semilla del boundary MIME: es único por
      // envío y no expone nada que no estuviera ya en el propio correo.
      boundarySeed: input.reference,
    });

    // Gmail devuelve el id del mensaje; si no viniera, la referencia de origen sigue permitiendo
    // correlacionar el envío con la operación que lo pidió.
    return { trackingId: sent.id ?? input.reference };
  }
}
