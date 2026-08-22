/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza completa trabajo asíncrono y recuperable fuera de la latencia del request.
 * @system reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  AddressGpsObservationModel,
  CustomerSessionModel,
  DataQualityIssueModel,
  DeviceSnapshotModel,
  FormFieldInteractionEventModel,
  OperationalAuditLogModel,
  IdempotencyKeyModel,
  OutboxEventModel,
  RetentionPolicyModel,
  SystemJobRunModel,
  TenantModel,
} from '../../database/models/index.js';
import { CreditModule } from '../credit/credit.module.js';
import { CustomerOnboardingModule } from '../customer-onboarding/customer-onboarding.module.js';
import { LoansModule } from '../loans/loans.module.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RuntimeJobsController } from './runtime-jobs.controller.js';
import { RuntimeJobsSchedulerService } from './runtime-jobs-scheduler.service.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';
import { RuntimeMaintenanceJobsService } from './runtime-maintenance-jobs.service.js';
import { JobRunRecorderService } from './job-run-recorder.service.js';
import { BankStatementReviewWorker } from '../credit/application/bank-statement-review.worker.js';
import { CreditLineRefreshService } from '../credit/application/credit-line-refresh.service.js';
import { LoanDelinquencyService } from '../loans/application/loan-delinquency.service.js';
import { OnboardingAbandonmentService } from '../customer-onboarding/application/onboarding-abandonment.service.js';
import { buildScheduledJobs, SCHEDULED_JOBS } from './scheduled-jobs.catalog.js';

@Module({
  imports: [
    EventsModule,
    // El barrido de notificaciones atascadas (hallazgo A-03) reutiliza el MISMO orquestador que la
    // entrega normal, para que un reintento no pueda divergir del camino feliz.
    NotificationsModule,
    // Aporta `OnboardingAbandonmentService`: el cierre de los onboardings abandonados es un trabajo
    // de fondo más, y su regla de negocio vive en el módulo de onboarding, no aquí.
    CustomerOnboardingModule,
    // El barrido de mora y el recálculo de la línea son trabajos de fondo, pero sus reglas viven en
    // sus dominios: aquí sólo se declara CADA CUÁNTO corren, no QUÉ hacen.
    LoansModule,
    CreditModule,
    SequelizeModule.forFeature([
      SystemJobRunModel,
      OutboxEventModel,
      CustomerSessionModel,
      RetentionPolicyModel,
      DataQualityIssueModel,
      OperationalAuditLogModel,
      AddressGpsObservationModel,
      DeviceSnapshotModel,
      FormFieldInteractionEventModel,
      IdempotencyKeyModel,
      TenantModel,
    ]),
  ],
  controllers: [RuntimeJobsController],
  providers: [
    JobRunRecorderService,
    RuntimeJobsService,
    RuntimeMaintenanceJobsService,
    RuntimeJobsSchedulerService,
    {
      provide: SCHEDULED_JOBS,
      useFactory: (
        runtimeJobs: RuntimeJobsService,
        maintenance: RuntimeMaintenanceJobsService,
        onboardingAbandonment: OnboardingAbandonmentService,
        delinquency: LoanDelinquencyService,
        creditLineRefresh: CreditLineRefreshService,
        bankStatements: BankStatementReviewWorker,
      ) => buildScheduledJobs({ runtimeJobs, maintenance, onboardingAbandonment, delinquency, creditLineRefresh, bankStatements }),
      inject: [
        RuntimeJobsService,
        RuntimeMaintenanceJobsService,
        OnboardingAbandonmentService,
        LoanDelinquencyService,
        CreditLineRefreshService,
        BankStatementReviewWorker,
      ],
    },
  ],
})
export class RuntimeJobsModule {}
