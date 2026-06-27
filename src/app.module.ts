import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { DatabaseModule } from './database/sequelize.module.js';
import { ConsentsModule } from './modules/consents/consents.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { RiskModule } from './modules/risk/risk.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CustomersModule,
    ConsentsModule,
    SessionsModule,
    RiskModule,
    OperationsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
  ],
})
export class AppModule {}
