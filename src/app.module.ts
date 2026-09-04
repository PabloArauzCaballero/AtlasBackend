/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza implementa las capacidades operativas, de identidad, riesgo y crédito de Atlas.
 * @system organiza el runtime NestJS en módulos con límites explícitos y dependencias dirigidas.
 */
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { CommonAuthModule } from './common/common-auth.module.js';
import { FilesModule } from './common/files/files.module.js';
import { ResilienceModule } from './common/resilience/resilience.module.js';
import { REDIS_CLIENT, RedisModule } from './common/redis/redis.module.js';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler-storage.js';
import { IdempotencyInterceptor } from './modules/runtime-hardening/idempotency.interceptor.js';
import { ApiCommandOutboxInterceptor } from './modules/runtime-hardening/outbox.interceptor.js';
import { RuntimeHardeningModule } from './modules/runtime-hardening/runtime-hardening.module.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { RequestTimeoutInterceptor } from './common/interceptors/request-timeout.interceptor.js';
import { LifecycleModule } from './common/lifecycle/lifecycle.module.js';
import { HttpActionLogInterceptor } from './common/interceptors/http-action-log.interceptor.js';
import { HttpMetricsInterceptor } from './common/observability/http-metrics.interceptor.js';
import { ObservabilityModule } from './common/observability/observability.module.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { DatabaseModule } from './database/sequelize.module.js';
import { ReadDatabaseModule } from './database/read-database.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { SystemsOpsModule } from './modules/systems-ops/systems-ops.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogManagementModule } from './modules/catalog-management/catalog-management.module.js';
import { ConsentsModule } from './modules/consents/consents.module.js';
import { CreditModule } from './modules/credit/credit.module.js';
import { CreditRatingModule } from './modules/credit-rating/credit-rating.module.js';
import { DecisionEngineModule } from './modules/decision-engine/decision-engine.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { LoanPaymentClaimsModule } from './modules/loan-payment-claims/loan-payment-claims.module.js';
import { LoansModule } from './modules/loans/loans.module.js';
import { CustomerOnboardingModule } from './modules/customer-onboarding/customer-onboarding.module.js';
import { ExpedientesModule } from './modules/expedientes/expedientes.module.js';
import { MobileIdentityModule } from './modules/mobile-identity/mobile-identity.module.js';
import { MobileWelcomeAudioModule } from './modules/mobile-welcome-audio/mobile-welcome-audio.module.js';
import { PartnerOnboardingModule } from './modules/partner-onboarding/partner-onboarding.module.js';
import { CustomerDeviceSignalsModule } from './modules/customer-device-signals/customer-device-signals.module.js';
import { CustomerPrivacyModule } from './modules/customer-privacy/customer-privacy.module.js';
import { CustomerTelemetryModule } from './modules/customer-telemetry/customer-telemetry.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DataQualityModule } from './modules/data-quality/data-quality.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { RuntimeJobsModule } from './modules/runtime-jobs/runtime-jobs.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { AppContentModule } from './modules/app-content/app-content.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ExternalDataModule } from './modules/external-data/external-data.module.js';
import { InternalUsersModule } from './modules/internal-users/internal-users.module.js';
import { MerchantIdentityModule } from './modules/merchant-identity/merchant-identity.module.js';
import { RiskModule } from './modules/risk/risk.module.js';
import { FraudModule } from './modules/fraud/fraud.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { SchemaManagementModule } from './modules/schema-management/schema-management.module.js';
import { InternalPortalModule } from './modules/internal-portal/internal-portal.module.js';
import { LogSyncModule } from './modules/log-sync/log-sync.module.js';
import { DataNotebookModule } from './modules/data-notebook/data-notebook.module.js';
import { SqlConsoleModule } from './modules/sql-console/sql-console.module.js';
import { WorkflowCatalogModule } from './modules/workflow-catalog/workflow-catalog.module.js';
import { env } from './config/env.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    LifecycleModule,
    ResilienceModule,
    FilesModule,
    ObservabilityModule,
    CommonAuthModule,
    // En producción, REDIS_URL mantiene el contador de rate limit compartido entre instancias.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redisClient: Redis | null) => ({
        throttlers: [{ ttl: env.API_RATE_LIMIT_TTL_MS, limit: env.API_RATE_LIMIT_MAX }],
        storage: redisClient ? new RedisThrottlerStorage(redisClient) : undefined,
      }),
    }),
    DatabaseModule,
    ReadDatabaseModule.register(),
    RuntimeHardeningModule,
    RuntimeJobsModule,
    NotificationsModule,
    // Lo que la app enseña y no es un dato del cliente: bienvenida, ayuda, preguntas frecuentes y
    // enlaces legales. Estaba en el código de la app; ahora lo edita negocio desde el portal.
    AppContentModule,
    EventsModule,
    HealthModule,
    CatalogManagementModule,
    AuthModule,
    InternalUsersModule,
    MerchantIdentityModule,
    CustomersModule,
    CustomerOnboardingModule,
    ExpedientesModule,
    MobileIdentityModule,
    MobileWelcomeAudioModule,
    PartnerOnboardingModule,
    CreditModule,
    DecisionEngineModule,
    LoansModule,
    LoanPaymentClaimsModule,
    SupportModule,
    CreditRatingModule,
    CustomerDeviceSignalsModule,
    CustomerPrivacyModule,
    CustomerTelemetryModule,
    ConsentsModule,
    SessionsModule,
    RiskModule,
    FraudModule,
    ExternalDataModule,
    OperationsModule,
    DataQualityModule,
    AuditModule,
    SystemsOpsModule,
    SchemaManagementModule,
    InternalPortalModule,
    LogSyncModule,
    WorkflowCatalogModule,
    DataNotebookModule,
    SqlConsoleModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Fase 3.4: el interceptor de métricas va PRIMERO (el más externo) para medir la latencia total
    // del request, incluyendo el resto de interceptores. No-op si METRICS_ENABLED=false.
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    // Justo dentro del interceptor de métricas: así un request que se corta por timeout SÍ queda
    // medido (con su 503), en vez de desaparecer de las series. Ver hallazgo A-07.
    { provide: APP_INTERCEPTOR, useClass: RequestTimeoutInterceptor },
    // Action log debe envolver también replays de idempotencia; por eso va antes del interceptor
    // de idempotencia. El resto conserva el contrato: idempotencia -> outbox -> respuesta.
    { provide: APP_INTERCEPTOR, useClass: HttpActionLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ApiCommandOutboxInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    /*
     * Deny by default: la sesión se exige aquí, no en cada controlador.
     *
     * Hasta ahora el único guard global era el de rate limiting, así que una ruta quedaba
     * autenticada SÓLO si su controlador se acordaba de escribir `@UseGuards(JwtAuthGuard, ...)`.
     * Con 70 controladores y tres mecanismos de autorización conviviendo, dos se olvidaron —y no
     * de rutas menores: una servía el carnet y la selfie de cualquier cliente, y la otra reasignaba
     * qué artefacto decide crédito, identidad y riesgo—. Ambas declaraban `@Roles(...)`, que sin
     * guard no es más que un comentario ejecutable: nadie lee esa metadata.
     *
     * El defecto no era el descuido, era que el descuido no costaba nada. Invertido el defecto, un
     * controlador nuevo nace cerrado y abrirlo exige escribir `@Public()`, que se ve en la revisión,
     * sale en el contrato OpenAPI como `security: []` y aparece en la lista del gate
     * `check:auth-coverage`.
     *
     * El orden importa: primero el límite de peticiones (rechaza sin trabajo), después la sesión, y
     * al final los roles, que necesitan el `request.user` que el guard anterior puebla.
     *
     * Esto NO cambia el comportamiento de ninguna ruta que ya estuviera protegida ni de ninguna que
     * ya fuese `@Public()`. Las únicas que cambian son las dos citadas arriba, que pasan a exigir
     * sesión —que es lo que su propio decorador de roles decía— y las dos excepciones deliberadas
     * (`/metrics` y el callback del motor) que ahora lo declaran en su fichero.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
