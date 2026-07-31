/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  SystemEndpointCatalogModel,
  WorkflowDefinitionModel,
  WorkflowStageModel,
  WorkflowStepDependencyModel,
  WorkflowStepModel,
  WorkflowTransitionModel,
} from '../../database/models/index.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ExposedRouteScannerService } from './application/exposed-route-scanner.service.js';
import { WorkflowConsistencyService } from './application/workflow-consistency.service.js';
import { WorkflowProgressService } from './application/workflow-progress.service.js';
import { WorkflowTransitionService } from './application/workflow-transition.service.js';
import { WorkflowCatalogController } from './workflow-catalog.controller.js';
import { WorkflowCatalogRepository } from './workflow-catalog.repository.js';
import { WorkflowCatalogService } from './workflow-catalog.service.js';
import { WorkflowOperationsController } from './workflow-operations.controller.js';
import { WorkflowProgressController } from './workflow-progress.controller.js';

/**
 * `DiscoveryModule` es lo que permite a `ExposedRouteScannerService` preguntarle al contenedor qué
 * controladores quedaron montados. `CustomersModule` aporta la evaluación de habilitación, única
 * fuente del avance del cliente: el catálogo describe el recorrido, no lo recalcula.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      WorkflowDefinitionModel,
      WorkflowStageModel,
      WorkflowStepModel,
      WorkflowStepDependencyModel,
      WorkflowTransitionModel,
      SystemEndpointCatalogModel,
    ]),
    DiscoveryModule,
    CustomersModule,
  ],
  controllers: [WorkflowCatalogController, WorkflowProgressController, WorkflowOperationsController],
  providers: [
    WorkflowCatalogRepository,
    WorkflowCatalogService,
    WorkflowTransitionService,
    WorkflowProgressService,
    WorkflowConsistencyService,
    ExposedRouteScannerService,
  ],
  exports: [WorkflowCatalogService],
})
export class WorkflowCatalogModule {}
