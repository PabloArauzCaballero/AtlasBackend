/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.
 * @system encapsula el cliente HTTP de correo y sus plantillas, timeouts y errores tipados.
 */
import { Module } from '@nestjs/common';
import { ResilienceModule } from '../../common/resilience/resilience.module.js';
import { GmailMailModule } from '../notifications/adapters/gmail/gmail-mail.module.js';
import { GmailMailTransport } from './gmail-mail.transport.js';
import { WebhookMailTransport } from './webhook-mail.transport.js';
import { MailSenderClient } from './mail-sender.client.js';
import { MailSenderService } from './mail-sender.service.js';

// `GmailMailModule` y no `NotificationsModule`: importar el módulo entero traería siete tablas y
// cinco canales, y —lo que directamente lo impide— un ciclo, porque notificaciones importa usuarios
// internos, que importa auth, que importa este módulo.
@Module({
  imports: [ResilienceModule, GmailMailModule],
  providers: [MailSenderClient, GmailMailTransport, WebhookMailTransport, MailSenderService],
  exports: [MailSenderService],
})
export class MailSenderModule {}
