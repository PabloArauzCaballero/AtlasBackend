/**
 * @file Raíz de composición del worker (AT-045).
 * @business El worker ejecuta trabajos programados, relay de eventos y entregas; no expone rutas de negocio
 *   ni necesita los módulos que sólo sirven HTTP (portal interno, consola SQL, cuaderno de datos, auditoría
 *   de lectura, gestión de esquemas).
 * @system Importa la infraestructura técnica y `RuntimeJobsModule`, que a su vez trae —por sus handlers— los
 *   módulos de negocio que los jobs necesitan. Sin `controllers` propios: Nest no monta ninguna ruta. Conserva
 *   lo que el proceso worker exige hoy: base, Redis, ciclo de vida/cierre ordenado, resiliencia, archivos,
 *   observabilidad (métricas para la sonda), plataforma (reloj), eventos y notificaciones.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonAuthModule } from '../common/common-auth.module.js';
import { FilesModule } from '../common/files/files.module.js';
import { LifecycleModule } from '../common/lifecycle/lifecycle.module.js';
import { ObservabilityModule } from '../common/observability/observability.module.js';
import { RedisModule } from '../common/redis/redis.module.js';
import { ResilienceModule } from '../common/resilience/resilience.module.js';
import { ReadDatabaseModule } from '../database/read-database.module.js';
import { DatabaseModule } from '../database/sequelize.module.js';
import { EventsModule } from '../modules/events/events.module.js';
import { NotificationsModule } from '../modules/notifications/notifications.module.js';
import { RuntimeHardeningModule } from '../modules/runtime-hardening/runtime-hardening.module.js';
import { RuntimeJobsModule } from '../modules/runtime-jobs/runtime-jobs.module.js';
import { PlatformModule } from '../platform/platform.module.js';

/** Módulos que la API monta y el worker NO: sólo sirven HTTP o lectura operativa. */
export const WORKER_EXCLUDED_MODULES = Object.freeze([
  'InternalPortalModule',
  'SqlConsoleModule',
  'DataNotebookModule',
  'SchemaManagementModule',
  'WorkflowCatalogModule',
  'AuditModule',
  'HealthModule',
  'AppContentModule',
  'MobileWelcomeAudioModule',
]);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    LifecycleModule,
    ResilienceModule,
    FilesModule,
    ObservabilityModule,
    PlatformModule,
    CommonAuthModule,
    DatabaseModule,
    ReadDatabaseModule,
    RuntimeHardeningModule,
    EventsModule,
    NotificationsModule,
    RuntimeJobsModule,
  ],
})
export class WorkerModule {}
