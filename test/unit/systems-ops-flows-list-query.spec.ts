import { describe, expect, it, jest } from '@jest/globals';
import { SystemFlowsAsyncService } from '../../src/modules/systems-ops/system-flows.async.service.js';
import { SystemFlowsScreensService } from '../../src/modules/systems-ops/system-flows.screens.service.js';
import {
  containsText,
  pendingWorkQuerySchema,
  rbacDriftQuerySchema,
  slicePage,
} from '../../src/modules/systems-ops/system-flows.list-query.js';

/**
 * La deriva de permisos y el trabajo pendiente eran dos informes que llegaban enteros (o cortados) y
 * el portal los pintaba como tarjetas sin buscador. Ahora buscan, filtran y paginan en el servidor.
 * Lo que se protege: que cada parámetro FILTRA de verdad (con filas que lo distinguen), que sin
 * `limit` la respuesta es la de siempre, y que las cifras de resumen no dependen del filtro.
 */
const MIN = 60_000;
const DIA = 86_400_000;
const hace = (ms: number) => new Date(Date.now() - ms);

describe('containsText · comparación literal', () => {
  it('no distingue mayúsculas y mira todos los campos', () => {
    expect(containsText('AUDIT', 'x', '/internal/audit')).toBe(true);
    expect(containsText('zzz', 'x', '/internal/audit', null, undefined)).toBe(false);
  });

  it('`%` y `_` son texto, no comodines: «50%» no casa con «500» ni «a_c» con «abc»', () => {
    expect(containsText('50%', '500')).toBe(false);
    expect(containsText('50%', 'descuento 50% total')).toBe(true);
    expect(containsText('a_c', 'abc')).toBe(false);
    expect(containsText('a_c', 'a_c')).toBe(true);
  });

  it('sin texto todo coincide', () => {
    expect(containsText(undefined, 'lo que sea')).toBe(true);
  });
});

describe('slicePage', () => {
  const filas = Array.from({ length: 25 }, (_, i) => i);
  it('sin limit devuelve todo y no inventa meta', () => {
    expect(slicePage(filas, 1, undefined)).toEqual({ items: filas });
  });
  it('con limit corta la página y declara el total del conjunto', () => {
    const p3 = slicePage(filas, 3, 10);
    expect(p3.items).toEqual([20, 21, 22, 23, 24]);
    expect(p3.meta).toEqual({ page: 3, limit: 10, total: 25, totalPages: 3 });
  });
});

describe('esquemas de consulta: lo no declarado se descarta en silencio, así que se declara', () => {
  it('rbac-drift acepta q, severity, clientCode, page y limit; rechaza limit > 100 y una severidad inventada', () => {
    expect(rbacDriftQuerySchema.parse({ q: ' auth ', severity: 'SIN_GUARDA', clientCode: 'ADMIN_PORTAL', page: '2', limit: '20' })).toEqual(
      {
        q: 'auth',
        severity: 'SIN_GUARDA',
        clientCode: 'ADMIN_PORTAL',
        page: 2,
        limit: 20,
      },
    );
    expect(rbacDriftQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(rbacDriftQuerySchema.safeParse({ severity: 'GRAVE' }).success).toBe(false);
    expect(rbacDriftQuerySchema.parse({ severity: 'MENU_PERMISO_DISTINTO' }).severity).toBe('MENU_PERMISO_DISTINTO');
    expect(rbacDriftQuerySchema.parse({ severity: 'PERMISO_FUERA_DEL_CATALOGO' }).severity).toBe('PERMISO_FUERA_DEL_CATALOGO');
    expect(rbacDriftQuerySchema.parse({}).limit).toBeUndefined();
  });

  it('pending-work acepta q, state, page y limit, y deja pasar windowDays sin validarlo', () => {
    expect(pendingWorkQuerySchema.parse({ windowDays: 'abc', state: 'failed', limit: '10' })).toMatchObject({
      windowDays: 'abc',
      state: 'failed',
      limit: 10,
      page: 1,
    });
    expect(pendingWorkQuerySchema.safeParse({ state: 'roto' }).success).toBe(false);
  });
});

describe('SystemFlowsScreensService.rbacDrift · buscar, filtrar y paginar', () => {
  const fila = (over: Record<string, unknown> = {}) => ({
    client_code: 'ADMIN_PORTAL',
    route: '/internal/audit',
    nav_permissions: ['audit.events.read'],
    nav_roles: [],
    method: 'GET',
    path: 'systems/action-logs',
    flow_id: 'flow_1',
    roles: [],
    is_public: false,
    ...over,
  });
  const FILAS = [
    fila(),
    fila({ flow_id: 'flow_2', path: 'systems/flows', roles: ['system_admin'] }),
    fila({ route: '/internal/files', flow_id: 'flow_3', path: 'files/nodes', is_public: true }),
    fila({ client_code: 'MOTOR_PORTAL', route: '/executions', flow_id: 'flow_4', path: 'ExecController.list', roles: [] }),
    fila({ client_code: 'MOTOR_PORTAL', route: '/executions', flow_id: 'flow_5', path: 'ExecController.get', roles: ['x'] }),
  ];
  const servicio = () =>
    new SystemFlowsScreensService({
      rbacDrift: async () => FILAS,
      rbacCatalogPermissions: async () => new Set(['audit.events.read']),
      menusWithPermissions: async () => [],
      flowsWithPermissions: async () => [],
      rolePermissions: async () => null,
      screensWithObservedRoutes: jest.fn(async () => 9),
      clientsWithMenuGates: async () => ['ADMIN_PORTAL', 'MOTOR_PORTAL'],
    } as never);
  const ids = (items: Array<{ flowId: string | null }>) => items.map((i) => i.flowId);

  it('sin parámetros: `items` trae todas las llamadas, lo más grave primero; no hay meta y `screens` sigue igual', async () => {
    const r = await servicio().rbacDrift();
    expect(ids(r.items)).toEqual(['flow_1', 'flow_4', 'flow_3', 'flow_2', 'flow_5']);
    expect(r.meta).toBeUndefined();
    expect(r.screens).toHaveLength(3);
    expect(r.items[0]).toEqual({
      clientCode: 'ADMIN_PORTAL',
      route: '/internal/audit',
      navPermissions: ['audit.events.read'],
      navRoles: [],
      flowId: 'flow_1',
      method: 'GET',
      path: 'systems/action-logs',
      severity: 'SIN_GUARDA',
      roles: [],
      permissions: [],
      missingFromMenu: [],
      missingFromCatalog: [],
    });
  });

  it('`severity` deja sólo esa clase', async () => {
    expect(ids((await servicio().rbacDrift({ severity: 'SIN_GUARDA' })).items)).toEqual(['flow_1', 'flow_4']);
    expect(ids((await servicio().rbacDrift({ severity: 'PUBLIC' })).items)).toEqual(['flow_3']);
  });

  it('`clientCode` deja sólo las pantallas de ese cliente', async () => {
    expect(ids((await servicio().rbacDrift({ clientCode: 'MOTOR_PORTAL' })).items)).toEqual(['flow_4', 'flow_5']);
  });

  it('`q` busca en pantalla, ruta, método, flujo y cliente, sin distinguir mayúsculas', async () => {
    expect(ids((await servicio().rbacDrift({ q: 'FILES' })).items)).toEqual(['flow_3']);
    expect(ids((await servicio().rbacDrift({ q: 'execcontroller.get' })).items)).toEqual(['flow_5']);
    expect(ids((await servicio().rbacDrift({ q: 'flow_2' })).items)).toEqual(['flow_2']);
    expect(ids((await servicio().rbacDrift({ q: 'motor' })).items)).toEqual(['flow_4', 'flow_5']);
    expect((await servicio().rbacDrift({ q: 'no-existe' })).items).toEqual([]);
  });

  it('`%` y `_` en `q` son texto: «%» sólo casa con algo que lo contenga', async () => {
    expect((await servicio().rbacDrift({ q: '%' })).items).toEqual([]);
    expect((await servicio().rbacDrift({ q: 'flow_' })).items).toHaveLength(5);
    expect((await servicio().rbacDrift({ q: 'flow-' })).items).toEqual([]);
  });

  it('con `limit` pagina lo YA filtrado y `meta.total` cuenta las coincidencias', async () => {
    const p1 = await servicio().rbacDrift({ page: 1, limit: 2 });
    expect(ids(p1.items)).toEqual(['flow_1', 'flow_4']);
    expect(p1.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
    const p3 = await servicio().rbacDrift({ page: 3, limit: 2 });
    expect(ids(p3.items)).toEqual(['flow_5']);
    const filtrada = await servicio().rbacDrift({ clientCode: 'ADMIN_PORTAL', page: 1, limit: 2 });
    expect(filtrada.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('`summary` es del conjunto SIN filtrar, se busque lo que se busque', async () => {
    const todo = (await servicio().rbacDrift()).summary;
    const acotado = (await servicio().rbacDrift({ q: 'flow_1', severity: 'SIN_GUARDA', clientCode: 'ADMIN_PORTAL', page: 1, limit: 1 }))
      .summary;
    expect(acotado).toEqual(todo);
    expect(todo).toEqual({
      screensWithDrift: 3,
      calls: 5,
      breaking: 2,
      bySeverity: { PERMISO_FUERA_DEL_CATALOGO: 0, MENU_PERMISO_DISTINTO: 0, SIN_GUARDA: 2, PUBLIC: 1, SOLO_ROL: 2 },
      clients: ['ADMIN_PORTAL', 'MOTOR_PORTAL'],
      permissionsOutsideCatalog: [],
    });
  });
});

describe('SystemFlowsAsyncService.pendingWork · buscar, filtrar y paginar', () => {
  const fila = (over: Record<string, unknown> = {}) => ({
    method: 'POST',
    path: 'internal/auth/refresh',
    events: '4',
    pending: '0',
    processed: '4',
    failed: '0',
    other: '0',
    pending_without_tenant: '0',
    pending_since: null,
    last_processed_at: hace(MIN),
    codes: ['auth_refresh_completed'],
    ...over,
  });
  const FILAS = [
    fila({ path: 'loans/apply', pending: '3', pending_since: hace(9 * DIA), codes: ['loan_applied'] }),
    fila({ path: 'payments/confirm', failed: '2', codes: ['payment.confirmed'] }),
    fila({ method: 'PATCH', path: 'files/rename', pending: '1', pending_since: hace(2 * MIN), codes: ['file_renamed'] }),
    fila({ path: 'customers/update' }),
  ];
  const servicio = () =>
    new SystemFlowsAsyncService({
      pendingWork: async () => FILAS,
      domainEventConsumers: async () => [],
      outboxHealth: async () => ({
        pending: '4',
        pending_without_tenant: '0',
        failed: '2',
        oldest_pending: null,
        consumer_last_run: hace(MIN),
      }),
    } as never);
  const rutas = (r: { flows: Array<{ path: string }> }) => r.flows.map((f) => f.path);

  it('sin parámetros: `flows` llega entero y sin meta, como antes', async () => {
    const r = await servicio().pendingWork();
    expect(rutas(r)).toEqual(['loans/apply', 'payments/confirm', 'files/rename', 'customers/update']);
    expect(r.meta).toBeUndefined();
    expect(r.flowsThatEnqueue).toBe(4);
  });

  it('`q` busca en método, ruta y códigos de evento', async () => {
    expect(rutas(await servicio().pendingWork(30, { q: 'LOANS' }))).toEqual(['loans/apply']);
    expect(rutas(await servicio().pendingWork(30, { q: 'patch' }))).toEqual(['files/rename']);
    expect(rutas(await servicio().pendingWork(30, { q: 'payment.confirmed' }))).toEqual(['payments/confirm']);
    expect(rutas(await servicio().pendingWork(30, { q: 'post loans' }))).toEqual(['loans/apply']);
    expect(rutas(await servicio().pendingWork(30, { q: 'nada' }))).toEqual([]);
  });

  it('`%` y `_` en `q` son texto', async () => {
    expect(rutas(await servicio().pendingWork(30, { q: '%' }))).toEqual([]);
    expect(rutas(await servicio().pendingWork(30, { q: 'loan_applied' }))).toEqual(['loans/apply']);
    expect(rutas(await servicio().pendingWork(30, { q: 'loan-applied' }))).toEqual([]);
  });

  it('`state` separa pendientes, fallidos y saltados por el consumidor', async () => {
    expect(rutas(await servicio().pendingWork(30, { state: 'pending' }))).toEqual(['loans/apply', 'files/rename']);
    expect(rutas(await servicio().pendingWork(30, { state: 'failed' }))).toEqual(['payments/confirm']);
    // El pendiente de 9 días es anterior a la última pasada del consumidor: lo saltó. El de 2 minutos, no.
    expect(rutas(await servicio().pendingWork(30, { state: 'skipped' }))).toEqual(['loans/apply']);
  });

  it('con `limit` pagina lo filtrado y `meta.total` cuenta las coincidencias', async () => {
    const p1 = await servicio().pendingWork(30, { page: 1, limit: 3 });
    expect(rutas(p1)).toEqual(['loans/apply', 'payments/confirm', 'files/rename']);
    expect(p1.meta).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
    const p2 = await servicio().pendingWork(30, { page: 2, limit: 3 });
    expect(rutas(p2)).toEqual(['customers/update']);
    const filtrada = await servicio().pendingWork(30, { state: 'pending', page: 1, limit: 1 });
    expect(rutas(filtrada)).toEqual(['loans/apply']);
    expect(filtrada.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it('`summary`, `diagnosis`, `skipped` y `failing` son de TODOS los flujos, no de la página ni del filtro', async () => {
    const todo = await servicio().pendingWork();
    const acotado = await servicio().pendingWork(30, { q: 'customers', state: 'pending', page: 1, limit: 1 });
    expect(acotado.summary).toEqual(todo.summary);
    expect(todo.summary).toEqual({ flows: 4, withPending: 2, withFailed: 1, skipped: 1 });
    expect(acotado.diagnosis).toBe(todo.diagnosis);
    expect(acotado.skipped).toEqual(['POST loans/apply']);
    expect(acotado.failing).toEqual(['POST payments/confirm']);
    expect(acotado.flowsThatEnqueue).toBe(4);
  });
});
