/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WorkflowGraphDto, WorkflowStageDto, WorkflowSummaryDto, WorkflowTransitionDto, WorkflowTreeDto } from './workflow-catalog.dtos.js';
import { ListWorkflowsQueryDto, WorkflowTreeQueryDto } from './workflow-catalog.schemas.js';
import { WorkflowBundle, WorkflowCatalogRepository } from './workflow-catalog.repository.js';
import { filterWorkflowBundle } from './workflow-bundle-filter.util.js';
import { buildWorkflowGraph } from './workflow-graph.builder.js';
import { toWorkflowSummary, toWorkflowTransition, toWorkflowTree } from './workflow-catalog.mapper.js';

/**
 * Lecturas del catálogo de flujos.
 *
 * Todas las respuestas se construyen sobre el mismo bundle (definición + etapas + pasos +
 * dependencias + transiciones) para que el árbol, el grafo y la lista de etapas no puedan divergir:
 * son proyecciones distintas del MISMO conjunto de filas leído en un número fijo de consultas, no
 * consultas independientes que podrían filtrar de forma sutilmente distinta.
 */
@Injectable()
export class WorkflowCatalogService {
  private readonly logger = new Logger(WorkflowCatalogService.name);

  constructor(private readonly repository: WorkflowCatalogRepository) {}

  async listWorkflows(query: ListWorkflowsQueryDto): Promise<WorkflowSummaryDto[]> {
    const definitions = await this.repository.findDefinitions({
      status: query.status,
      processType: query.processType,
      ownerDomain: query.ownerDomain,
      includeDeprecated: query.includeDeprecated,
    });
    if (!query.moduleCode && !query.role) return definitions.map(toWorkflowSummary);

    const facets = await this.repository.findFacetsByDefinition(definitions.map((definition) => String(definition.id)));
    return definitions
      .filter((definition) => {
        const facet = facets.get(String(definition.id));
        if (query.moduleCode && !facet?.modules.has(query.moduleCode)) return false;
        // Un flujo sin ningún rol declarado es visible para cualquier rol: los pasos sin `@Roles`
        // solo exigen autenticación, y filtrarlos fuera escondería el flujo entero sin motivo.
        if (query.role && facet && facet.roles.size > 0 && !facet.roles.has(query.role)) return false;
        return true;
      })
      .map(toWorkflowSummary);
  }

  async listVersions(workflowCode: string): Promise<WorkflowSummaryDto[]> {
    const versions = await this.repository.findVersions(workflowCode);
    if (versions.length === 0) throw new NotFoundException('WORKFLOW_NOT_FOUND');
    return versions.map(toWorkflowSummary);
  }

  async getTree(workflowCode: string, query: WorkflowTreeQueryDto): Promise<WorkflowTreeDto> {
    const bundle = await this.loadFilteredBundle(workflowCode, query);
    return toWorkflowTree(bundle);
  }

  /** Etapas en orden de ejecución, aplanadas con su profundidad. Para pintar un stepper lineal. */
  async listStages(workflowCode: string, query: WorkflowTreeQueryDto): Promise<Array<WorkflowStageDto & { depth: number }>> {
    const tree = toWorkflowTree(await this.loadFilteredBundle(workflowCode, query));
    const flattened: Array<WorkflowStageDto & { depth: number }> = [];
    const walk = (stages: WorkflowStageDto[], depth: number): void => {
      for (const stage of stages) {
        flattened.push({ ...stage, depth });
        walk(stage.subStages, depth + 1);
      }
    };
    walk(tree.stages, 0);
    return flattened;
  }

  async listTransitions(workflowCode: string, query: WorkflowTreeQueryDto): Promise<WorkflowTransitionDto[]> {
    const bundle = await this.loadFilteredBundle(workflowCode, query);
    const stepCodeById = new Map(bundle.steps.map((step) => [String(step.id), step.stepCode]));
    return bundle.transitions.map((transition) => toWorkflowTransition(transition, stepCodeById));
  }

  async getGraph(workflowCode: string, query: WorkflowTreeQueryDto): Promise<WorkflowGraphDto> {
    return buildWorkflowGraph(await this.loadFilteredBundle(workflowCode, query));
  }

  /**
   * Resuelve código + versión a un bundle, ya recortado por los filtros de la petición.
   *
   * Es el único punto donde el módulo traduce "no existe" a un 404: cualquier lectura que no pueda
   * resolver la versión pedida falla igual, en vez de devolver un árbol vacío que el consumidor
   * interpretaría como "el flujo existe pero no tiene etapas".
   */
  async loadFilteredBundle(workflowCode: string, query: WorkflowTreeQueryDto): Promise<WorkflowBundle> {
    const bundle = await this.loadBundle(workflowCode, query.version);
    return filterWorkflowBundle(bundle, {
      moduleCode: query.moduleCode,
      role: query.role,
      lifecycleStatus: query.lifecycleStatus,
      actorType: query.actorType,
    });
  }

  async loadBundle(workflowCode: string, version: string): Promise<WorkflowBundle> {
    const definition = await this.repository.findDefinition(workflowCode, version);
    if (!definition) {
      this.logger.warn(`Flujo no encontrado: workflowCode=${workflowCode} version=${version}`);
      throw new NotFoundException('WORKFLOW_NOT_FOUND');
    }
    return this.repository.loadBundle(definition);
  }
}
