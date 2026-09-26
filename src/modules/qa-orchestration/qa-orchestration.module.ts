/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza reúne el motor de journeys QA: API de control, worker y contexto QA.
 * @system el middleware de contexto QA se monta para todas las rutas: sin credencial firmada es un
 *   no-op, y con ella sólo etiqueta la petición para el mock; nunca autoriza nada.
 */
import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { InternalUsersModule } from '../internal-users/internal-users.module.js';
import { QaEnvironmentService } from './application/qa-environment.js';
import { QaJourneyConsumerService } from './application/qa-journey-consumer.service.js';
import { QaRunClosing } from './application/qa-run-closing.js';
import { QaRunExecutionService } from './application/qa-run-execution.service.js';
import { QaRunOrchestratorService } from './application/qa-run-orchestrator.service.js';
import { QaRunReadService } from './application/qa-run-read.service.js';
import { QaWorkflowMatcher } from './application/qa-workflow-matcher.js';
import { QaContextMiddleware } from './infrastructure/qa-context.middleware.js';
import { QaRunAdmissionRepository } from './infrastructure/qa-run-admission.repository.js';
import { QaRunQueryRepository } from './infrastructure/qa-run-query.repository.js';
import { QaRunSupportRepository } from './infrastructure/qa-run-support.repository.js';
import { QaRunWorkerRepository } from './infrastructure/qa-run-worker.repository.js';
import { QaRunsController } from './qa-runs.controller.js';

@Module({
  // `InternalPermissionsGuard` se instancia en el módulo que lo monta y necesita el repositorio RBAC.
  imports: [InternalUsersModule],
  controllers: [QaRunsController],
  providers: [
    QaEnvironmentService,
    QaRunOrchestratorService,
    QaRunReadService,
    QaWorkflowMatcher,
    QaRunExecutionService,
    QaRunClosing,
    QaJourneyConsumerService,
    QaRunAdmissionRepository,
    QaRunQueryRepository,
    QaRunWorkerRepository,
    QaRunSupportRepository,
    QaContextMiddleware,
  ],
  exports: [QaJourneyConsumerService],
})
export class QaOrchestrationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(QaContextMiddleware).forRoutes('*');
  }
}
