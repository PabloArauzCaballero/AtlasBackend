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
import { LogSyncModule } from '../modules/log-sync/log-sync.module.js';
import { RuntimeJobsModule } from '../modules/runtime-jobs/runtime-jobs.module.js';
import { SystemsOpsModule } from '../modules/systems-ops/systems-ops.module.js';
import { PlatformModule } from '../platform/platform.module.js';

/**
 * Módulos que la API alcanza y el worker NO, calculado sobre el CIERRE de `imports` (no el primer
 * nivel). La prueba de AT-045 compara esta lista con la diferencia real y falla si alguien añade o
 * quita uno sin decidirlo: la versión anterior era una lista de 9 nombres escrita a mano, y por eso se
 * colaron `SystemsOpsModule` (monitor de salud) y `LogSyncModule` (tope del Archivo.log), que sí traen
 * trabajo de fondo y dejaron de correr en TODOS los procesos (revisión independiente B, hallazgos 1-3).
 *
 * Lo que NO dice esta lista: el worker sí alcanza Clientes, Crédito, Auth, Sesiones y varios más
 * transitivamente, porque `NotificationsModule` los importa. Es la deuda que documenta
 * `docs/architecture/microservices/remaining-exceptions.md`, no un objetivo cumplido.
 */
export const WORKER_EXCLUDED_MODULES = Object.freeze([
  'AppContentModule',
  'AuditModule',
  'CatalogManagementModule',
  'CustomerDeviceSignalsModule',
  'CustomerPrivacyModule',
  'CustomerTelemetryModule',
  'DataNotebookModule',
  'DataQualityModule',
  'DiscoveryModule',
  'FraudModule',
  'HealthModule',
  'InternalPortalModule',
  'LoanPaymentClaimsModule',
  'MerchantIdentityModule',
  'MobileIdentityModule',
  'MobileWelcomeAudioModule',
  'OperationsModule',
  'SchemaManagementModule',
  'SqlConsoleModule',
  'ThrottlerModule',
  'WorkflowCatalogModule',
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
    // Revisión independiente B, hallazgos 1 y 2: estos DOS traen trabajo de fondo que sólo corre donde
    // corre el worker. `SystemsOpsModule` monta el monitor de salud de herramientas críticas (se
    // autodesactiva si `runsBackgroundWork()` es falso, o sea en la API): sin él, nadie sondea ni avisa.
    // `LogSyncModule` acota el Archivo.log local —con Mongo o sin él— y cada proceso tiene su propio
    // archivo: sin él, el del worker crece sin tope (ya pasó cuando el clúster de Mongo desapareció).
    SystemsOpsModule,
    LogSyncModule,
  ],
})
export class WorkerModule {}
