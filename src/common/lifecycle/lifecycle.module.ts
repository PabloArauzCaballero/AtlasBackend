/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza evita cortar peticiones en curso durante un despliegue o un reinicio.
 * @system provee infraestructura transversal de ciclo de vida sin introducir reglas de un dominio específico.
 */
import { Global, Module } from '@nestjs/common';
import { GracefulShutdownService } from './graceful-shutdown.service.js';
import { RedisLifecycleService } from './redis-lifecycle.service.js';

/**
 * Ciclo de vida del proceso: drenado ordenado en `SIGTERM` y cierre de conexiones externas
 * (hallazgo A-07 de `docs/audit/auditoria-integral-2026-07-30.md`). Es `@Global` porque
 * `HealthController` necesita consultar el estado de apagado sin importar este módulo.
 */
@Global()
@Module({
  providers: [GracefulShutdownService, RedisLifecycleService],
  exports: [GracefulShutdownService],
})
export class LifecycleModule {}
