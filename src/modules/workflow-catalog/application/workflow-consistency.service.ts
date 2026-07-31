/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
 * @system expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { SystemEndpointCatalogModel } from '../../../database/models/index.js';
import { CUSTOMER_LIFECYCLE_STATUSES } from '../../customers/customer-lifecycle.constants.js';
import { buildEndpointCode } from '../../systems-ops/endpoint-code.util.js';
import { WorkflowConsistencyDto } from '../workflow-catalog.dtos.js';
import { WorkflowBundle } from '../workflow-catalog.repository.js';
import { WorkflowCatalogService } from '../workflow-catalog.service.js';
import { ExposedRoute, ExposedRouteScannerService } from './exposed-route-scanner.service.js';

type Issue = WorkflowConsistencyDto['issues'][number];

const LIFECYCLE_STATUSES = new Set<string>(CUSTOMER_LIFECYCLE_STATUSES);

/**
 * Detecta la divergencia entre el árbol sembrado y lo que el backend expone de verdad.
 *
 * Es la pieza que impide que este catálogo se convierta en documentación que envejece en silencio.
 * Un flujo que apunta a una ruta que ya no existe no da error hasta que un cliente la llama; aquí
 * sale como `error` en cuanto alguien pide el informe, y el gate de CI puede exigir cero errores.
 *
 * Severidades, con criterio explícito:
 *  - `error`   → el árbol MIENTE sobre el backend (ruta inexistente, código derivado incoherente,
 *                estado de ciclo de vida que la máquina de estados no conoce). Rompe a un consumidor.
 *  - `warning` → el árbol está desactualizado pero sigue siendo utilizable (roles divergentes, ruta
 *                del mismo dominio sin mapear, endpoint aún no descubierto por el catálogo técnico).
 */
@Injectable()
export class WorkflowConsistencyService {
  constructor(
    private readonly catalogService: WorkflowCatalogService,
    private readonly routeScanner: ExposedRouteScannerService,
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointCatalogModel: typeof SystemEndpointCatalogModel,
  ) {}

  async check(workflowCode: string, version: string): Promise<WorkflowConsistencyDto> {
    const bundle = await this.catalogService.loadBundle(workflowCode, version);
    const exposed = this.routeScanner.scan();
    const exposedByKey = new Map(exposed.map((route) => [routeKey(route.method, route.routePath), route]));

    const catalogued = await this.findCataloguedEndpointCodes(bundle);

    const issues: Issue[] = [
      ...bundle.steps.flatMap((step) => this.checkStep(step, exposedByKey, catalogued)),
      ...this.checkUnmappedRoutes(bundle, exposed),
    ];

    return {
      workflowCode: bundle.definition.workflowCode,
      version: bundle.definition.version,
      checkedAt: new Date().toISOString(),
      exposedRouteCount: exposed.length,
      stepCount: bundle.steps.length,
      status: issues.some((issue) => issue.severity === 'error') ? 'drift_detected' : 'in_sync',
      issues,
    };
  }

  private async findCataloguedEndpointCodes(bundle: WorkflowBundle): Promise<Set<string>> {
    const codes = [...new Set(bundle.steps.map((step) => step.endpointCode))];
    if (codes.length === 0) return new Set();
    const rows = await this.endpointCatalogModel.findAll({
      where: { code: { [Op.in]: codes } },
      attributes: ['code'],
    } as FindOptions);
    return new Set(rows.map((row) => row.code));
  }

  private checkStep(step: WorkflowBundle['steps'][number], exposedByKey: Map<string, ExposedRoute>, catalogued: Set<string>): Issue[] {
    const issues: Issue[] = [];
    const route = exposedByKey.get(routeKey(step.httpMethod, step.routePath));

    if (!route) {
      issues.push({
        severity: 'error',
        code: 'STEP_ROUTE_NOT_EXPOSED',
        stepCode: step.stepCode,
        detail: `${step.httpMethod} ${step.routePath} no está montada en la aplicación.`,
      });
    } else {
      // Los roles del catálogo se comparan como conjuntos: el orden del decorador no es contrato,
      // pero un rol de más o de menos sí cambia quién puede recorrer el flujo.
      const declared = [...new Set(step.allowedRoles ?? [])].sort();
      const actual = [...new Set(route.isPublic ? [] : route.roles)].sort();
      if (declared.join(',') !== actual.join(',')) {
        issues.push({
          severity: 'warning',
          code: 'STEP_ROLES_DIVERGED',
          stepCode: step.stepCode,
          detail: `roles del catálogo [${declared.join(', ')}] vs del endpoint [${actual.join(', ')}].`,
        });
      }
    }

    const expectedCode = buildEndpointCode(step.httpMethod, step.routePath);
    if (step.endpointCode !== expectedCode) {
      issues.push({
        severity: 'error',
        code: 'STEP_ENDPOINT_CODE_MISMATCH',
        stepCode: step.stepCode,
        detail: `endpointCode "${step.endpointCode}" no deriva de ${step.httpMethod} ${step.routePath} (esperado "${expectedCode}").`,
      });
    } else if (!catalogued.has(step.endpointCode)) {
      issues.push({
        severity: 'warning',
        code: 'STEP_NOT_IN_ENDPOINT_CATALOG',
        stepCode: step.stepCode,
        detail: `${step.endpointCode} todavía no fue descubierto por el catálogo técnico de endpoints.`,
      });
    }

    const unknownStates = [...(step.requiredStates ?? []), ...(step.resultingStates ?? [])].filter(
      (state) => !LIFECYCLE_STATUSES.has(state),
    );
    if (unknownStates.length > 0) {
      issues.push({
        severity: 'error',
        code: 'STEP_UNKNOWN_LIFECYCLE_STATE',
        stepCode: step.stepCode,
        detail: `estados fuera de la máquina de estados del cliente: ${[...new Set(unknownStates)].join(', ')}.`,
      });
    }

    return issues;
  }

  /**
   * Rutas expuestas del mismo dominio que el flujo pero sin ningún paso que las represente.
   *
   * El alcance se limita al primer segmento de las rutas ya mapeadas (p. ej. `customer-onboarding`).
   * Comparar contra las 250+ rutas del backend produciría un informe con más ruido que señal: la
   * mayoría pertenece a administración, gobierno o pruebas y no forma parte de ningún recorrido de
   * negocio. Dentro de un dominio que el flujo SÍ cubre, en cambio, una ruta sin mapear suele
   * significar que se agregó un paso al proceso y nadie actualizó el árbol.
   */
  private checkUnmappedRoutes(bundle: WorkflowBundle, exposed: ExposedRoute[]): Issue[] {
    const mapped = new Set(bundle.steps.map((step) => routeKey(step.httpMethod, step.routePath)));
    const coveredPrefixes = new Set(bundle.steps.map((step) => firstSegment(step.routePath)));

    return exposed
      .filter((route) => coveredPrefixes.has(firstSegment(route.routePath)) && !mapped.has(routeKey(route.method, route.routePath)))
      .map((route) => ({
        severity: 'warning' as const,
        code: 'ROUTE_NOT_MAPPED' as const,
        stepCode: null,
        detail: `${route.method} ${route.routePath} (${route.controllerName}.${route.handlerName}) no participa de ninguna etapa del flujo.`,
      }));
  }
}

function routeKey(method: string, routePath: string): string {
  return `${method.toUpperCase()} ${routePath.replace(/\/+$/, '') || '/'}`;
}

function firstSegment(routePath: string): string {
  return routePath.replace(/^\/+/, '').split('/')[0] ?? '';
}
