/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.
 * @system centraliza idempotencia y outbox como garantías transversales del runtime HTTP.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { IdempotencyKeyModel, OutboxEventModel } from '../../database/models/index.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { ApiCommandOutboxInterceptor } from './outbox.interceptor.js';
import { RuntimeHardeningService } from './runtime-hardening.service.js';
import { IdempotencyClaimStore } from './infrastructure/idempotency-claim.store.js';

@Module({
  imports: [SequelizeModule.forFeature([IdempotencyKeyModel, OutboxEventModel])],
  providers: [IdempotencyClaimStore, RuntimeHardeningService, IdempotencyInterceptor, ApiCommandOutboxInterceptor],
  exports: [RuntimeHardeningService, IdempotencyInterceptor, ApiCommandOutboxInterceptor],
})
export class RuntimeHardeningModule {}
