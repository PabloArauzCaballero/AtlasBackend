/**
 * @file Envío del correo interno por el canal de ATLAS (Gmail API), compartido por las dos entradas.
 * @business Propuestas y facturas del ERP llegan al comercio desde la cuenta de ATLAS, con su PDF.
 * @system una sola implementación para la ruta con sesión (propuesta) y la firmada S2S (facturas del worker).
 */
import { ServiceUnavailableException } from '@nestjs/common';
import type { GmailApiAdapter } from './adapters/gmail/gmail.adapter.js';
import type { InternalMailDto } from './internal-mail.schemas.js';

export async function sendInternalMail(
  gmail: GmailApiAdapter,
  body: InternalMailDto,
): Promise<{ provider: string; messageId: string | null }> {
  if (!gmail.isEnabled()) {
    throw new ServiceUnavailableException({
      code: 'MAIL_PROVIDER_NOT_CONFIGURED',
      message: 'Este entorno no tiene la Gmail API como proveedor de correo (NOTIFICATION_EMAIL_PROVIDER=gmail_api).',
    });
  }
  const sent = await gmail.sendEmail({
    to: [body.to],
    subject: body.subject,
    text: body.text,
    html: body.html ?? null,
    replyTo: body.replyTo ?? null,
    fromName: body.fromName ?? null,
    boundarySeed: body.reference,
    attachments: body.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: Buffer.from(attachment.contentBase64, 'base64'),
    })),
  });
  return { provider: 'gmail_api', messageId: sent.id };
}
