/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.
 * @system encapsula el cliente HTTP de correo y sus plantillas, timeouts y errores tipados.
 */
import { Module } from '@nestjs/common';
import { ResilienceModule } from '../../common/resilience/resilience.module.js';
import { MailSenderClient } from './mail-sender.client.js';
import { MailSenderService } from './mail-sender.service.js';

@Module({
  imports: [ResilienceModule],
  providers: [MailSenderClient, MailSenderService],
  exports: [MailSenderService],
})
export class MailSenderModule {}
