import { describe, expect, it, jest } from '@jest/globals';
import { WorkflowConsistencyService } from '../../../src/modules/workflow-catalog/application/workflow-consistency.service.js';
import type { ExposedRoute } from '../../../src/modules/workflow-catalog/application/exposed-route-scanner.service.js';
import { buildBundle, buildStep } from './workflow-bundle.fixtures.js';
import type { WorkflowBundle } from '../../../src/modules/workflow-catalog/workflow-catalog.repository.js';

const EXPOSED: ExposedRoute[] = [
  { method: 'POST', routePath: '/auth/login', controllerName: 'AuthController', handlerName: 'login', roles: [], isPublic: true },
  {
    method: 'PATCH',
    routePath: '/customer-onboarding/:customerId/profile',
    controllerName: 'ProfileController',
    handlerName: 'update',
    roles: ['customer'],
    isPublic: false,
  },
  {
    method: 'GET',
    routePath: '/operations/work-queue',
    controllerName: 'OperationsController',
    handlerName: 'queue',
    roles: ['internal_operator'],
    isPublic: false,
  },
];

function buildService(options: { bundle?: WorkflowBundle; exposed?: ExposedRoute[]; catalogued?: string[] } = {}) {
  const bundle = options.bundle ?? buildBundle();
  const catalogService = { loadBundle: jest.fn(async () => bundle) };
  const routeScanner = { scan: jest.fn(() => options.exposed ?? EXPOSED) };
  const codes = options.catalogued ?? bundle.steps.map((step) => step.endpointCode);
  const endpointCatalogModel = { findAll: jest.fn(async () => codes.map((code) => ({ code }))) };
  return {
    service: new WorkflowConsistencyService(catalogService as never, routeScanner as never, endpointCatalogModel as never),
    bundle,
  };
}

describe('WorkflowConsistencyService.check', () => {
  it('reporta in_sync cuando cada paso corresponde a una ruta montada y los roles coinciden', async () => {
    const { service } = buildService();

    const report = await service.check('demo_flow', 'latest');

    expect(report.status).toBe('in_sync');
    expect(report.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    expect(report).toMatchObject({ workflowCode: 'demo_flow', version: 'v1', stepCount: 3, exposedRouteCount: 3 });
  });

  it('marca STEP_ROUTE_NOT_EXPOSED como error cuando la ruta ya no existe', async () => {
    const { service } = buildService({ exposed: EXPOSED.filter((route) => route.routePath !== '/operations/work-queue') });

    const report = await service.check('demo_flow', 'latest');

    expect(report.status).toBe('drift_detected');
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STEP_ROUTE_NOT_EXPOSED', severity: 'error', stepCode: 'step.three' })]),
    );
  });

  it('marca STEP_ENDPOINT_CODE_MISMATCH cuando el código no deriva del método y la ruta', async () => {
    const bundle = buildBundle();
    bundle.steps[0] = { ...bundle.steps[0], endpointCode: 'ESCRITO_A_MANO' } as never;
    const { service } = buildService({ bundle });

    const report = await service.check('demo_flow', 'latest');

    expect(report.status).toBe('drift_detected');
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STEP_ENDPOINT_CODE_MISMATCH', stepCode: 'step.one' })]),
    );
  });

  it('avisa (sin romper) cuando el endpoint aún no fue descubierto por el catálogo técnico', async () => {
    const { service } = buildService({ catalogued: [] });

    const report = await service.check('demo_flow', 'latest');

    expect(report.status).toBe('in_sync');
    expect(report.issues.filter((issue) => issue.code === 'STEP_NOT_IN_ENDPOINT_CATALOG')).toHaveLength(3);
  });

  it('avisa cuando los roles del catálogo divergen de los del endpoint, sin importar el orden', async () => {
    const bundle = buildBundle();
    bundle.steps[2] = { ...bundle.steps[2], allowedRoles: ['internal_operator', 'admin'] } as never;
    const { service } = buildService({ bundle });

    const report = await service.check('demo_flow', 'latest');

    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STEP_ROLES_DIVERGED', severity: 'warning', stepCode: 'step.three' })]),
    );
  });

  it('trata un endpoint público como "sin roles" al comparar', async () => {
    const { service } = buildService();

    const report = await service.check('demo_flow', 'latest');

    // `step.one` declara [] y la ruta es `@Public()`: no debe reportarse divergencia.
    expect(report.issues.filter((issue) => issue.code === 'STEP_ROLES_DIVERGED')).toHaveLength(0);
  });

  it('marca como error un estado del ciclo de vida que la máquina de estados no conoce', async () => {
    const bundle = buildBundle();
    bundle.steps[0] = { ...bundle.steps[0], requiredStates: ['aprobado_para_todo'] } as never;
    const { service } = buildService({ bundle });

    const report = await service.check('demo_flow', 'latest');

    expect(report.status).toBe('drift_detected');
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STEP_UNKNOWN_LIFECYCLE_STATE', severity: 'error', stepCode: 'step.one' })]),
    );
  });

  it('avisa de rutas sin mapear SOLO dentro de los dominios que el flujo ya cubre', async () => {
    const exposed: ExposedRoute[] = [
      ...EXPOSED,
      { method: 'POST', routePath: '/auth/logout', controllerName: 'AuthController', handlerName: 'logout', roles: [], isPublic: true },
      {
        method: 'GET',
        routePath: '/systems/dashboard',
        controllerName: 'SystemsController',
        handlerName: 'dashboard',
        roles: ['system_admin'],
        isPublic: false,
      },
    ];
    const { service } = buildService({ exposed });

    const report = await service.check('demo_flow', 'latest');

    const unmapped = report.issues.filter((issue) => issue.code === 'ROUTE_NOT_MAPPED');
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0].detail).toContain('/auth/logout');
  });

  it('no consulta el catálogo técnico cuando el flujo no tiene pasos', async () => {
    const bundle = buildBundle();
    bundle.steps = [];
    const { service } = buildService({ bundle });

    const report = await service.check('demo_flow', 'latest');

    expect(report.stepCount).toBe(0);
    expect(report.status).toBe('in_sync');
  });

  it('acumula varios hallazgos del mismo paso en vez de cortar en el primero', async () => {
    const bundle = buildBundle();
    bundle.steps = [
      buildStep({
        id: '100',
        stepCode: 'step.rota',
        workflowStageId: '10',
        httpMethod: 'GET',
        routePath: '/ruta/inexistente',
        endpointCode: 'MAL_ESCRITO',
        requiredStates: ['estado_falso'],
      }),
    ];
    const { service } = buildService({ bundle, catalogued: [] });

    const report = await service.check('demo_flow', 'latest');

    expect(report.issues.map((issue) => issue.code).sort()).toEqual([
      'STEP_ENDPOINT_CODE_MISMATCH',
      'STEP_ROUTE_NOT_EXPOSED',
      'STEP_UNKNOWN_LIFECYCLE_STATE',
    ]);
  });
});
