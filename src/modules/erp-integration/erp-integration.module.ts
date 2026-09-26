/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Integración de eventos Core ↔ ERP (P-14): recibir la cobertura y la recuperación que el ERP
 *   liquida, y entregarle los avisos de pago que el comercio confirma o rechaza en Core.
 * @system Receptor S2S firmado + inbox (API) y servicio de entrega saliente (lo usa el trabajo
 *   `deliver_erp_events` del worker). Sin modelos ORM propios: SQL sobre sus tablas de `platform_ops`.
 */
import { Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { ErpEventDeliveryService } from './erp-event-delivery.service.js';
import { ErpEventInboxService } from './erp-event-inbox.service.js';
import { ErpEventsController } from './erp-events.controller.js';
import { SignedEventGuard } from './signed-event.guard.js';

@Module({
  controllers: [ErpEventsController],
  providers: [
    ErpEventInboxService,
    SignedEventGuard,
    // Fábrica y no inyección por tipo: el publicador y la política salen del entorno, no del contenedor.
    {
      provide: ErpEventDeliveryService,
      useFactory: (sequelize: Sequelize) => new ErpEventDeliveryService(sequelize),
      inject: [getConnectionToken()],
    },
  ],
  exports: [ErpEventDeliveryService, ErpEventInboxService],
})
export class ErpIntegrationModule {}
