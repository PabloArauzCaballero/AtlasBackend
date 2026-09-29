import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { ProcessCatalogService } from '../../../src/modules/workflow-catalog/application/process-catalog.service.js';
import { definitionHash } from '../../../src/modules/workflow-catalog/definitions/workflow-catalog.sync.js';
import { WORKFLOW_DEFINITIONS } from '../../../src/modules/workflow-catalog/definitions/workflow-definitions.registry.js';

/**
 * La sección Procesos no reescribe lo que dice el código: cuenta. Estas pruebas fijan las tres cuentas
 * que alguien va a usar para decidir —documentado, cableado, en la base— con un repositorio falso.
 */
const SIGNUP = WORKFLOW_DEFINITIONS.find((d) => d.code === 'account_signup_to_login')!;

function build(overrides: Record<string, unknown> = {}) {
  const repository = {
    syncRows: jest.fn(async () => [
      {
        workflowCode: SIGNUP.code,
        version: 'v1',
        contentHash: definitionHash(SIGNUP),
        appliedBy: 'test',
        appliedAt: '2026-09-26T00:00:00Z',
      },
    ]),
    flowsFor: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    countByStatus: jest.fn(async (..._args: unknown[]) => [{ status: 'registered', total: 3 }]),
    listInstances: jest.fn(async (..._args: unknown[]) => ({ rows: [{ id: '7', label: 'CUS-7', status: 'registered' }], total: 1 })),
    findInstance: jest.fn(async (..._args: unknown[]) => ({ id: '7', label: 'CUS-7', status: 'registered' }) as unknown),
    ...overrides,
  };
  return { service: new ProcessCatalogService(repository as never), repository };
}

/** El primer paso HTTP de una etapa de persona interna en el portal admin (si lo hay). */
function internalAdminStep() {
  for (const f of WORKFLOW_DEFINITIONS)
    for (const s of f.stages)
      if (s.actor === 'internal_user' && s.client === 'ADMIN_PORTAL')
        for (const p of s.steps) if ((p.kind ?? 'http') === 'http') return { f, s, p };
  throw new Error('no hay ningún paso interno en el registro');
}

describe('ProcessCatalogService.list', () => {
  it('lista todos los procesos del registro, ordenados por id, con sus totales', async () => {
    const { service } = build();
    const result = await service.list();
    expect(result.items).toHaveLength(WORKFLOW_DEFINITIONS.length);
    expect(result.items.map((i) => i.processId)).toEqual([...result.items.map((i) => i.processId)].sort());
    expect(result.totals.processes).toBe(WORKFLOW_DEFINITIONS.length);
  });

  it('sólo da por volcado un proceso cuya huella en la base es la del código', async () => {
    const { service } = build();
    const items = (await service.list()).items;
    expect(items.find((i) => i.code === SIGNUP.code)!.documentation.inDatabase).toBe(true);
    expect(items.find((i) => i.code !== SIGNUP.code)!.documentation.inDatabase).toBe(false);
  });

  it('una huella vieja en la base no cuenta como volcado', async () => {
    const { service } = build({
      syncRows: jest.fn(async () => [{ workflowCode: SIGNUP.code, version: 'v1', contentHash: 'vieja', appliedBy: 't', appliedAt: 'x' }]),
    });
    expect((await service.list()).items.find((i) => i.code === SIGNUP.code)!.documentation.inDatabase).toBe(false);
  });
});

describe('ProcessCatalogService: cableado', () => {
  it('un paso de persona interna es «wired» si el portal admin figura entre sus llamadores y «unwired» si no', async () => {
    const { f, p } = internalAdminStep();
    const path = p.path!.replace(/^\//, '').replace(/:[A-Za-z0-9_]+/g, ':p');
    const flow = (callers: string[]) => ({
      systemCode: p.system ?? 'ATLAS_BACKEND',
      method: p.method!,
      path,
      flowId: 'F-1',
      callers,
      verification: 'VERIFIED',
      risk: 'LOW',
    });

    const wired = build({ flowsFor: jest.fn(async () => [flow(['ADMIN_PORTAL'])]) });
    const stepW = (await wired.service.wiring(f.code)).steps.find((s) => s.stepCode === p.code)!;
    expect(stepW.wiring).toBe('wired');

    const unwired = build({ flowsFor: jest.fn(async () => [flow(['CONSUMER_APP'])]) });
    const stepU = (await unwired.service.wiring(f.code)).steps.find((s) => s.stepCode === p.code)!;
    expect(stepU.wiring).toBe('unwired');
  });

  it('sin fila de Flujos el paso queda «unknown»: no se afirma lo que no se ha podido mirar', async () => {
    const { f, p } = internalAdminStep();
    const { service } = build();
    expect((await service.wiring(f.code)).steps.find((s) => s.stepCode === p.code)!.wiring).toBe('unknown');
  });

  it('la ficha enriquece cada paso con su tipo, su bloque y su cableado', async () => {
    const { service } = build();
    const detail = await service.detail(SIGNUP.code);
    const step = detail.stages[0]!.steps[0]!;
    expect(step.kind).toBe('http');
    expect(step.system).toBe('ATLAS_BACKEND');
    expect(detail.codeHash).toBe(definitionHash(SIGNUP));
    expect(detail.databaseHash).toBe(definitionHash(SIGNUP));
  });

  it('la ficha trae el estado de prueba del flujo de cada paso, y la lista cuenta críticos y verificados', async () => {
    // Lo único que aportaba «Procesos de negocio» (que leía el volcado y no el código) era esto:
    // si el flujo tiene test y cuántos pasos son críticos o están verificados.
    const { f, p } = internalAdminStep();
    const path = p.path!.replace(/^\//, '').replace(/:[A-Za-z0-9_]+/g, ':p');
    const flowRow = {
      systemCode: p.system ?? 'ATLAS_BACKEND',
      method: p.method!,
      path,
      flowId: 'F-9',
      callers: ['ADMIN_PORTAL'],
      verification: 'VERIFIED',
      risk: 'CRITICAL',
      testStatus: 'UNTESTED',
    };
    const { service } = build({ flowsFor: jest.fn(async () => [flowRow]) });
    const detail = await service.detail(f.code);
    const step = detail.stages.flatMap((s) => s.steps).find((s) => s.code === p.code)!;
    expect(step).toMatchObject({ flowId: 'F-9', testStatus: 'UNTESTED', risk: 'CRITICAL', verification: 'VERIFIED' });
    expect(detail.flowStats.critical).toBeGreaterThanOrEqual(1);
    expect(detail.flowStats.verified).toBeGreaterThanOrEqual(1);
    const item = (await service.list()).items.find((i) => i.code === f.code)!;
    expect(item.flowStats).toEqual(detail.flowStats);
  });

  it('sin fila de Flujos el paso no inventa estado de prueba y los contadores quedan en cero', async () => {
    const { service } = build();
    const detail = await service.detail(SIGNUP.code);
    expect(detail.stages[0]!.steps[0]!.testStatus).toBeNull();
    expect(detail.flowStats).toEqual({ linked: 0, critical: 0, verified: 0 });
  });

  it('un código que no existe es 404 PROCESS_NOT_FOUND', async () => {
    const { service } = build();
    await expect(service.detail('no_existe')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProcessCatalogService: el ERP-front llega a Core por su pasarela', () => {
  it('un paso del ERP-front sobre una ruta de Core cuenta como cableado si el ERP la llama', async () => {
    const found = WORKFLOW_DEFINITIONS.flatMap((f) =>
      f.stages
        .filter((s) => s.client === 'ERP_PORTAL' && (s.actor === 'merchant_user' || s.actor === 'internal_user'))
        .flatMap((s) =>
          s.steps.filter((p) => (p.kind ?? 'http') === 'http' && (p.system ?? 'ATLAS_BACKEND') === 'ATLAS_BACKEND').map((p) => ({ f, p })),
        ),
    )[0];
    if (!found) return;
    const path = found.p.path!.replace(/^\//, '').replace(/:[A-Za-z0-9_]+/g, ':p');
    const { service } = build({
      flowsFor: jest.fn(async () => [
        {
          systemCode: 'ATLAS_BACKEND',
          method: found.p.method!,
          path,
          flowId: 'F',
          callers: ['ERP_BACKEND'],
          verification: 'X',
          risk: 'LOW',
        },
      ]),
    });
    expect((await service.wiring(found.f.code)).steps.find((s) => s.stepCode === found.p.code)!.wiring).toBe('wired');
  });
});

describe('ProcessCatalogService: instancias', () => {
  it('cuenta por estado y marca como abiertas las que el proceso declara abiertas', async () => {
    const { service, repository } = build();
    const result = await service.instances(SIGNUP.code, '1', { page: 2, pageSize: 10 });
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.byStatus[0]).toEqual({ status: 'registered', total: 3, open: true });
    expect(repository.listInstances).toHaveBeenCalledWith(SIGNUP.instanceEntity, '1', {
      status: undefined,
      search: undefined,
      limit: 10,
      offset: 10,
    });
  });

  it('un proceso sin entidad en este bloque dice dónde mirar en vez de inventar una lista', async () => {
    const sinEntidad = WORKFLOW_DEFINITIONS.find((d) => !d.instanceEntity || d.instanceEntity.system !== 'ATLAS_BACKEND');
    if (!sinEntidad) return;
    const { service, repository } = build();
    const result = await service.instances(sinEntidad.code, '1', { page: 1, pageSize: 25 });
    expect(result.supported).toBe(false);
    expect(repository.countByStatus).not.toHaveBeenCalled();
  });

  it('el avance marca como actual la etapa cuyo estado de entrada es el de la instancia', async () => {
    const { service } = build();
    const result = await service.instanceProgress(SIGNUP.code, '1', '7');
    expect(result.instance.status).toBe('registered');
    const expected = SIGNUP.stages.filter((s) => (s.requiredStates ?? []).includes('registered')).map((s) => s.code);
    expect(result.stages.filter((s) => s.state === 'current').map((s) => s.code)).toEqual(expected);
  });

  it('una instancia que no existe es 404', async () => {
    const { service } = build({ findInstance: jest.fn(async () => null) });
    await expect(service.instanceProgress(SIGNUP.code, '1', '999')).rejects.toBeInstanceOf(NotFoundException);
  });
});
