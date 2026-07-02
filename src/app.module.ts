import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { CommonAuthModule } from './common/common-auth.module.js';
import { REDIS_CLIENT, RedisModule } from './common/redis/redis.module.js';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler-storage.js';
import { IdempotencyInterceptor } from './modules/runtime-hardening/idempotency.interceptor.js';
import { ApiCommandOutboxInterceptor } from './modules/runtime-hardening/outbox.interceptor.js';
import { RuntimeHardeningModule } from './modules/runtime-hardening/runtime-hardening.module.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { HttpActionLogInterceptor } from './common/interceptors/http-action-log.interceptor.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { DatabaseModule } from './database/sequelize.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogManagementModule } from './modules/catalog-management/catalog-management.module.js';
import { ConsentsModule } from './modules/consents/consents.module.js';
import { CustomerOnboardingModule } from './modules/customer-onboarding/customer-onboarding.module.js';
import { CustomerPrivacyModule } from './modules/customer-privacy/customer-privacy.module.js';
import { CustomerTelemetryModule } from './modules/customer-telemetry/customer-telemetry.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DataQualityModule } from './modules/data-quality/data-quality.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { RuntimeJobsModule } from './modules/runtime-jobs/runtime-jobs.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RiskModule } from './modules/risk/risk.module.js';
import { FraudModule } from './modules/fraud/fraud.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { env } from './config/env.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    CommonAuthModule,
    // ATLAS-AUDIT-023 (cerrado en este patch): antes usaba `ThrottlerModule.forRoot([...])` con
    // el storage en memoria por defecto de `@nestjs/throttler`, correcto solo con una instancia.
    // Ahora, si `REDIS_URL` está configurado (obligatorio en producción, ver `env.ts`), el
    // contador de rate limit vive en Redis y es correcto sin importar cuántas instancias del
    // backend estén corriendo detrás del Load Balancer.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redisClient: Redis | null) => ({
        throttlers: [{ ttl: env.API_RATE_LIMIT_TTL_MS, limit: env.API_RATE_LIMIT_MAX }],
        storage: redisClient ? new RedisThrottlerStorage(redisClient) : undefined,
      }),
    }),
    DatabaseModule,
    RuntimeHardeningModule,
    RuntimeJobsModule,
    NotificationsModule,
    EventsModule,
    HealthModule,
    CatalogManagementModule,
    AuthModule,
    CustomersModule,
    CustomerOnboardingModule,
    CustomerPrivacyModule,
    CustomerTelemetryModule,
    ConsentsModule,
    SessionsModule,
    RiskModule,
    FraudModule,
    OperationsModule,
    DataQualityModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Action log debe envolver también replays de idempotencia; por eso va antes del interceptor
    // de idempotencia. El resto conserva el contrato: idempotencia -> outbox -> respuesta.
    { provide: APP_INTERCEPTOR, useClass: HttpActionLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ApiCommandOutboxInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
