/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  WorkflowDefinitionModel,
  WorkflowStageModel,
  WorkflowStepDependencyModel,
  WorkflowStepModel,
  WorkflowTransitionModel,
} from '../../database/models/index.js';

/** Todo lo que compone una versión del flujo, leído en un número fijo de consultas. */
export type WorkflowBundle = {
  definition: WorkflowDefinitionModel;
  stages: WorkflowStageModel[];
  steps: WorkflowStepModel[];
  dependencies: WorkflowStepDependencyModel[];
  transitions: WorkflowTransitionModel[];
};

@Injectable()
export class WorkflowCatalogRepository {
  constructor(
    @InjectModel(WorkflowDefinitionModel) private readonly definitionModel: typeof WorkflowDefinitionModel,
    @InjectModel(WorkflowStageModel) private readonly stageModel: typeof WorkflowStageModel,
    @InjectModel(WorkflowStepModel) private readonly stepModel: typeof WorkflowStepModel,
    @InjectModel(WorkflowStepDependencyModel) private readonly dependencyModel: typeof WorkflowStepDependencyModel,
    @InjectModel(WorkflowTransitionModel) private readonly transitionModel: typeof WorkflowTransitionModel,
  ) {}

  findDefinitions(filter: {
    status?: string;
    processType?: string;
    ownerDomain?: string;
    includeDeprecated: boolean;
  }): Promise<WorkflowDefinitionModel[]> {
    const status = filter.status ? { status: filter.status } : filter.includeDeprecated ? {} : { status: { [Op.ne]: 'deprecated' } };
    return this.definitionModel.findAll({
      where: {
        deleted: false,
        ...status,
        ...(filter.processType ? { processType: filter.processType } : {}),
        ...(filter.ownerDomain ? { ownerDomain: filter.ownerDomain } : {}),
      },
      order: [
        ['workflowCode', 'ASC'],
        ['version', 'DESC'],
      ],
    } as FindOptions);
  }

  findVersions(workflowCode: string): Promise<WorkflowDefinitionModel[]> {
    return this.definitionModel.findAll({
      where: { workflowCode, deleted: false },
      order: [['version', 'DESC']],
    } as FindOptions);
  }

  /**
   * Resuelve la versión pedida.
   *
   * `latest` NO significa "la última fila insertada": significa la versión marcada como
   * predeterminada y, si ninguna lo está, la activa más reciente. Devolver un borrador solo porque
   * es el más nuevo haría que publicar un flujo a medio revisar cambiara el comportamiento de todos
   * los consumidores sin que nadie lo decidiera.
   */
  async findDefinition(workflowCode: string, version: string): Promise<WorkflowDefinitionModel | null> {
    if (version !== 'latest') {
      return this.definitionModel.findOne({ where: { workflowCode, version, deleted: false } } as FindOptions);
    }
    const candidates = await this.definitionModel.findAll({
      where: { workflowCode, deleted: false },
      order: [['version', 'DESC']],
    } as FindOptions);
    return candidates.find((row) => row.isDefault) ?? candidates.find((row) => row.status === 'active') ?? candidates[0] ?? null;
  }

  async loadBundle(definition: WorkflowDefinitionModel): Promise<WorkflowBundle> {
    const workflowDefinitionId = definition.id;
    const [stages, steps, dependencies, transitions] = await Promise.all([
      this.stageModel.findAll({
        where: { workflowDefinitionId, deleted: false },
        order: [['displayOrder', 'ASC']],
      } as FindOptions),
      this.stepModel.findAll({
        where: { workflowDefinitionId, deleted: false },
        order: [['executionOrder', 'ASC']],
      } as FindOptions),
      this.dependencyModel.findAll({ where: { workflowDefinitionId } } as FindOptions),
      this.transitionModel.findAll({
        where: { workflowDefinitionId },
        order: [['displayOrder', 'ASC']],
      } as FindOptions),
    ]);
    return { definition, stages, steps, dependencies, transitions };
  }

  /**
   * Códigos de módulo y roles presentes en cada flujo.
   *
   * Los filtros `moduleCode`/`role` del listado se aplican sobre esta proyección en vez de sobre un
   * `JOIN` con `DISTINCT`: el catálogo tiene decenas de filas, no millones, y traer dos columnas de
   * etapas y pasos evita que el listado dependa de índices que solo existirían para este filtro.
   */
  async findFacetsByDefinition(definitionIds: readonly string[]): Promise<Map<string, { modules: Set<string>; roles: Set<string> }>> {
    const facets = new Map<string, { modules: Set<string>; roles: Set<string> }>();
    if (definitionIds.length === 0) return facets;
    const ids = [...definitionIds];

    const [stages, steps] = await Promise.all([
      this.stageModel.findAll({
        where: { workflowDefinitionId: { [Op.in]: ids }, deleted: false },
        attributes: ['workflowDefinitionId', 'moduleCode', 'allowedRoles'],
      } as FindOptions),
      this.stepModel.findAll({
        where: { workflowDefinitionId: { [Op.in]: ids }, deleted: false },
        attributes: ['workflowDefinitionId', 'allowedRoles'],
      } as FindOptions),
    ]);

    const bucket = (id: string) => {
      const existing = facets.get(id);
      if (existing) return existing;
      const created = { modules: new Set<string>(), roles: new Set<string>() };
      facets.set(id, created);
      return created;
    };

    for (const stage of stages) {
      const entry = bucket(String(stage.workflowDefinitionId));
      entry.modules.add(stage.moduleCode);
      for (const role of stage.allowedRoles ?? []) entry.roles.add(role);
    }
    for (const step of steps) {
      const entry = bucket(String(step.workflowDefinitionId));
      for (const role of step.allowedRoles ?? []) entry.roles.add(role);
    }
    return facets;
  }
}
