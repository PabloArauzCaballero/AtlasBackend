/**
 * @file Servicio de aplicación: qué plantillas recorren qué flujos del árbol, por endpoint.
 * @business Esta pieza hace que «Ejecutar flujo con N personas» ofrezca las plantillas que de
 *   verdad pasan por ese flujo, y que el árbol pinte los conteos en SUS nodos.
 * @system casa método + ruta normalizados entre el catálogo de flujos (base) y las recetas; los
 *   códigos de paso difieren entre flujos, el endpoint no.
 */
import { Injectable } from '@nestjs/common';
import { FLUJO_CLIENTE_COMPLETO } from '../../../database/seeders/demo/flujo-cliente-completo.seed-data.js';
import { FLUJO_CLIENTE_PARTNER } from '../../../database/seeders/demo/flujo-cliente-partner.seed-data.js';
import { endpointKey, templateEndpoints } from '../catalog/journey-catalog.js';
import type { JourneyTemplate } from '../domain/journey-recipe.types.js';
import { QaRunQueryRepository } from '../infrastructure/qa-run-query.repository.js';

export type WorkflowStepEndpoint = { stepCode: string; endpoint: string };

/** Flujos declarados en el repositorio: sirven cuando la base todavía no los tiene sembrados. */
const DECLARED: Record<string, WorkflowStepEndpoint[]> = Object.fromEntries(
  [FLUJO_CLIENTE_COMPLETO, FLUJO_CLIENTE_PARTNER].map((flujo) => [
    flujo.code,
    flujo.stages.flatMap((stage) => stage.steps.map((step) => ({ stepCode: step.code, endpoint: endpointKey(step.method, step.path) }))),
  ]),
);

const CACHE_MS = 60_000;

@Injectable()
export class QaWorkflowMatcher {
  private readonly cache = new Map<string, { at: number; steps: WorkflowStepEndpoint[] }>();

  constructor(private readonly query: QaRunQueryRepository) {}

  async stepsOf(workflowCode: string): Promise<WorkflowStepEndpoint[]> {
    const cached = this.cache.get(workflowCode);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.steps;
    const rows = await this.query.workflowEndpoints(workflowCode).catch(() => []);
    const steps =
      rows.length > 0
        ? rows.map((row) => ({ stepCode: row.step_code, endpoint: endpointKey(row.http_method, row.route_path) }))
        : (DECLARED[workflowCode] ?? []);
    this.cache.set(workflowCode, { at: Date.now(), steps });
    return steps;
  }

  /** Pasos de ese flujo que la plantilla ejecuta. Vacío = la plantilla no recorre ese flujo. */
  async matchedSteps(template: JourneyTemplate, workflowCode: string): Promise<string[]> {
    const endpoints = templateEndpoints(template);
    return (await this.stepsOf(workflowCode)).filter((step) => endpoints.has(step.endpoint)).map((step) => step.stepCode);
  }
}
