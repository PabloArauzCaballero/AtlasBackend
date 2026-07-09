import { Global, Module } from '@nestjs/common';
import { ResilientAdapterExecutorService } from './resilient-adapter-executor.service.js';

/**
 * Módulo compartido de resiliencia para CUALQUIER familia de adaptador saliente
 * (`notifications`, `external-data`, o una integración nueva). `@Global()` porque
 * `ResilientAdapterExecutorService` es intencionalmente stateless-por-request (mantiene el
 * registro de circuit breakers en memoria del proceso) — no hay razón para que cada módulo lo
 * reimporte ni para que existan múltiples instancias compitiendo por el mismo estado.
 */
@Global()
@Module({
  providers: [ResilientAdapterExecutorService],
  exports: [ResilientAdapterExecutorService],
})
export class ResilienceModule {}
