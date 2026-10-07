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

  async findVersions(workflowCode: string): Promise<WorkflowDefinitionModel[]> {
    const versions = await this.definitionModel.findAll({ where: { workflowCode, deleted: false } } as FindOptions);
    return versions.sort(compareVersionsDesc);
  }

  /**
   * Resuelve la versión pedida.
   *
   * `latest` NO significa "la última fila insertada": significa la versión marcada como
   * predeterminada y, si ninguna lo está, la activa más reciente. Devolver un borrador solo porque
   * es el más nuevo haría que publicar un flujo a medio revisar cambiara el comportamiento de todos
   * los consumidores sin que nadie lo decidiera; por eso, sin predeterminada ni activa, no hay
   * versión `latest` (404) en vez de caer en un borrador o una versión deprecada.
   */
  async findDefinition(workflowCode: string, version: string): Promise<WorkflowDefinitionModel | null> {
    if (version !== 'latest') {
      return this.definitionModel.findOne({ where: { workflowCode, version, deleted: false } } as FindOptions);
    }
    const candidates = await this.findVersions(workflowCode);
    return candidates.find((row) => row.isDefault) ?? candidates.find((row) => row.status === 'active') ?? null;
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

/** Orden numérico descendente de `v9` < `v10` < `v10.1`: como texto, 'v9' quedaría por delante de 'v10'. */
function compareVersionsDesc(a: { version: string }, b: { version: string }): number {
  const parts = (version: string) => (/\d+(?:\.\d+)*/.exec(version)?.[0] ?? '').split('.').map(Number);
  const left = parts(a.version);
  const right = parts(b.version);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.version.localeCompare(a.version);
}
