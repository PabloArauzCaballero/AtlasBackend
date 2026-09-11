import { Op } from 'sequelize';
import { SystemFlowsRepository } from '../../src/modules/systems-ops/system-flows.repository.js';

/**
 * El repositorio de Flujos con dobles de los cuatro modelos. Lo que se comprueba no es «que llama a
 * Sequelize», sino las reglas que sólo viven aquí y se romperían en silencio: qué se conserva y qué
 * se retira al recargar un bloque, cómo se recuentan los hallazgos, y qué campos pide cada consulta.
 */
type Modelo = Record<string, jest.Mock>;

function build() {
  const modelo = (): Modelo => ({
    findAll: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })),
    create: jest.fn(async (values: unknown) => ({ id: '1', ...(values as object) })),
    update: jest.fn(async () => [0]),
    upsert: jest.fn(async () => [{}]),
    destroy: jest.fn(async () => 0),
    count: jest.fn(async () => 0),
  });
  const flows = modelo();
  const screens = modelo();
  const findings = modelo();
  const imports = modelo();
  // `sequelize` cuelga del modelo: la transacción y el SQL crudo salen de ahí.
  const sequelize = {
    transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work('tx')),
    query: jest.fn(async (_sql?: unknown, _opts?: unknown) => [] as unknown[]),
  };
  (flows as unknown as { sequelize: unknown }).sequelize = sequelize;
  const repo = new SystemFlowsRepository(flows as never, screens as never, findings as never, imports as never);
  return { repo, flows, screens, findings, imports, sequelize };
}

const filaFlujo = (over: Record<string, unknown> = {}) => ({ flowId: 'flow_000000000001', systemCode: 'ATLAS_BACKEND', ...over });

describe('SystemFlowsRepository · recarga por bloque', () => {
  it('replaceFlows retira del bloque lo que ya no viene, y sólo de ese bloque', async () => {
    const { repo, flows } = build();
    flows.destroy.mockImplementation(async () => 3);
    const result = await repo.replaceFlows(
      'ERP_BACKEND',
      [filaFlujo(), filaFlujo({ flowId: 'flow_000000000002' })] as never,
      'tx' as never,
    );
    expect(result).toEqual({ upserted: 2, removed: 3 });
    expect(flows.upsert).toHaveBeenCalledTimes(2);
    const where = flows.destroy.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.systemCode).toBe('ERP_BACKEND');
    // El `notIn` lleva justo los que sí vinieron: sin él, recargar borraría todo el bloque.
    // Se lee por el símbolo de Sequelize; `JSON.stringify` no serializa claves de tipo Symbol.
    expect((where.flowId as Record<symbol, string[]>)[Op.notIn]).toEqual(['flow_000000000001', 'flow_000000000002']);
  });

  it('una fila sin huella no borra la huella guardada: sin ella no se marcaría STALE ni se reabriría nada', async () => {
    const { repo, flows } = build();
    await repo.replaceFlows(
      'ATLAS_BACKEND',
      [filaFlujo({ depsHash: null }), filaFlujo({ flowId: 'flow_000000000002', depsHash: 'abc' })] as never,
      'tx' as never,
    );
    expect(flows.upsert.mock.calls[0][0]).not.toHaveProperty('depsHash');
    expect(flows.upsert.mock.calls[1][0]).toMatchObject({ depsHash: 'abc' });
  });

  it('el upsert declara la clave única compuesta: sin ella Sequelize choca contra la PK y responde 409', async () => {
    const { repo, flows } = build();
    await repo.replaceFlows('ATLAS_BACKEND', [filaFlujo()] as never, 'tx' as never);
    expect(flows.upsert.mock.calls[0][1]).toMatchObject({ conflictFields: ['system_code', 'http_method', 'path'] });
  });

  it('replaceScreens retira por cliente y por ruta, no por bloque', async () => {
    const { repo, screens } = build();
    await repo.replaceScreens('ADMIN_PORTAL', [{ clientCode: 'ADMIN_PORTAL', route: '/internal/flows' }] as never, 'tx' as never);
    expect(screens.upsert.mock.calls[0][1]).toMatchObject({ conflictFields: ['client_code', 'route'] });
    expect((screens.destroy.mock.calls[0][0].where as Record<string, unknown>).clientCode).toBe('ADMIN_PORTAL');
  });

  it('los hallazgos que dejan de venir se resuelven, no se borran: su historial es evidencia', async () => {
    const { repo, findings } = build();
    findings.update.mockResolvedValueOnce([4]);
    const result = await repo.replaceFindings('ATLAS_BACKEND', [{ findingKey: 'k1', systemCode: 'ATLAS_BACKEND' }] as never, 'tx' as never);
    expect(result).toEqual({ upserted: 1, removed: 4, reopened: 0 });
    expect(findings.destroy).not.toHaveBeenCalled();
    const [valores, opciones] = findings.update.mock.calls[0];
    expect(valores).toMatchObject({ status: 'resolved' });
    expect((opciones.where as Record<string, unknown>).status).toBe('open');
  });

  it('un hallazgo resuelto que vuelve a aparecer se reabre; el que una persona descartó, no', async () => {
    const { repo, findings } = build();
    const resuelto = { status: 'resolved', update: jest.fn(async (_values: unknown, _opts?: unknown) => undefined) };
    const descartado = { status: 'false_positive', update: jest.fn(async (_values: unknown, _opts?: unknown) => undefined) };
    findings.findOne.mockResolvedValueOnce(resuelto).mockResolvedValueOnce(descartado);
    const result = await repo.replaceFindings('ATLAS_BACKEND', [{ findingKey: 'k1' }, { findingKey: 'k2' }] as never, 'tx' as never);
    expect(resuelto.update.mock.calls[0][0]).toMatchObject({ status: 'open' });
    expect(descartado.update.mock.calls[0][0]).not.toHaveProperty('status');
    expect(result).toMatchObject({ reopened: 1 });
  });
});

describe('SystemFlowsRepository · recuento de hallazgos', () => {
  it('pone a cero el bloque antes de contar: si no, un flujo que dejó de tener hallazgos conservaría el número viejo', async () => {
    const { repo, findings, flows } = build();
    findings.findAll.mockResolvedValueOnce([{ ref: 'POST auth/login' }, { ref: 'POST auth/login' }, { ref: 'GET auth/me' }] as never);
    await repo.recountFindings('ATLAS_BACKEND', 'tx' as never);
    expect(flows.update.mock.calls[0][0]).toEqual({ findingsCount: 0 });
    const porRuta = flows.update.mock.calls
      .slice(1)
      .map(([valores, opciones]) => ({ n: valores.findingsCount, ...(opciones.where as Record<string, string>) }));
    expect(porRuta).toEqual([
      { n: 2, systemCode: 'ATLAS_BACKEND', httpMethod: 'POST', path: 'auth/login' },
      { n: 1, systemCode: 'ATLAS_BACKEND', httpMethod: 'GET', path: 'auth/me' },
    ]);
  });

  it('una referencia sin ruta se ignora en vez de escribir una fila con ruta vacía', async () => {
    const { repo, findings, flows } = build();
    findings.findAll.mockResolvedValueOnce([{ ref: 'SIN_RUTA' }] as never);
    await repo.recountFindings('ATLAS_BACKEND', 'tx' as never);
    expect(flows.update).toHaveBeenCalledTimes(1);
  });
});

describe('SystemFlowsRepository · consultas', () => {
  it('listFlows ordena el riesgo por significado y no por alfabeto', async () => {
    const { repo, flows } = build();
    await repo.listFlows({ page: 1, limit: 20 } as never);
    const orden = JSON.stringify(flows.findAndCountAll.mock.calls[0][0].order);
    expect(orden).toContain('CRITICAL');
    expect(orden.indexOf('CRITICAL')).toBeLessThan(orden.indexOf('HIGH'));
  });

  it('flowsOfSystem pide controller y handler: la verificación federada cruza por ahí, no por ruta', async () => {
    const { repo, flows } = build();
    await repo.flowsOfSystem('DECISION_ENGINE');
    const atributos = flows.findAll.mock.calls[0][0].attributes as string[];
    expect(atributos).toEqual(expect.arrayContaining(['controller', 'handler', 'analyzedCommit', 'freshness']));
  });

  it('findFlowsByModule ordena por ruta y método para que el grafo salga estable', async () => {
    const { repo, flows } = build();
    await repo.findFlowsByModule('ATLAS_BACKEND', 'auth');
    expect(flows.findAll.mock.calls[0][0]).toMatchObject({
      where: { systemCode: 'ATLAS_BACKEND', module: 'auth' },
      order: [
        ['path', 'ASC'],
        ['httpMethod', 'ASC'],
      ],
    });
  });

  it('listFindings muestra los abiertos salvo que pidan otro estado', async () => {
    const { repo, findings } = build();
    await repo.listFindings({ page: 1, limit: 20 } as never);
    expect((findings.findAndCountAll.mock.calls[0][0].where as Record<string, unknown>).status).toBe('open');
    await repo.listFindings({ page: 1, limit: 20, status: 'resolved' } as never);
    expect((findings.findAndCountAll.mock.calls[1][0].where as Record<string, unknown>).status).toBe('resolved');
  });

  it('runsByRoute pasa la ventana como parámetro, no interpolada en el SQL', async () => {
    const { repo, sequelize } = build();
    await repo.runsByRoute(7);
    expect(sequelize.query.mock.calls[0][1]).toMatchObject({ replacements: { windowDays: '7' } });
    expect(String(sequelize.query.mock.calls[0][0])).not.toContain("'7'");
  });

  it('runsByRoute indexa por método y ruta, y descarta las correlaciones nulas', async () => {
    const { repo, sequelize } = build();
    sequelize.query.mockResolvedValueOnce([
      {
        method: 'GET',
        path: 'auth/me',
        ok: '3',
        failed: '1',
        last_at: new Date('2026-09-09T00:00:00Z'),
        last_status: 200,
        statuses: { '200': 3 },
        correlation_sample: ['a', null],
      },
    ] as never);
    const runs = await repo.runsByRoute(30);
    const fila = runs.get('GET auth/me');
    expect(fila).toMatchObject({ ok: 3, failed: 1, lastStatus: 200 });
    expect(fila?.correlationSample).toEqual(['a']);
  });

  it('applyVerification y applyFreshness escriben dentro de la transacción que reciben', async () => {
    const { repo, flows } = build();
    await repo.applyVerification('flow_000000000001', { verification: 'VERIFIED', evidence: { ok: 1 } }, 'pablo', 'tx' as never);
    expect(flows.update.mock.calls[0][0]).toMatchObject({ verification: 'VERIFIED', verifiedBy: 'pablo' });
    expect(flows.update.mock.calls[0][1]).toMatchObject({ transaction: 'tx' });
    await repo.applyFreshness('flow_000000000001', 'STALE', 'tx' as never);
    expect(flows.update.mock.calls[1][0]).toMatchObject({ freshness: 'STALE' });
  });

  it('transaction delega en la del modelo: nadie abre una conexión propia', async () => {
    const { repo, sequelize } = build();
    await expect(repo.transaction(async (tx) => tx)).resolves.toBe('tx');
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });

  it('createImport sella la fecha de creación en el servidor, no en quien llama', async () => {
    const { repo, imports } = build();
    await repo.createImport({ scope: 'endpoints', systemCode: 'ATLAS_BACKEND' } as never, 'tx' as never);
    expect(imports.create.mock.calls[0][0].createdAtValue).toBeInstanceOf(Date);
  });

  it('latestImports devuelve los últimos primero y acotados', async () => {
    const { repo, imports } = build();
    await repo.latestImports();
    expect(imports.findAll.mock.calls[0][0]).toMatchObject({ order: [['createdAtValue', 'DESC']], limit: 30 });
  });
});

describe('SystemFlowsRepository · recargar el catálogo de pantallas', () => {
  it('la recarga NO pisa la verificación: es evidencia de uso, no un dato derivado del código', async () => {
    // `verification`, `verified_at`, `last_seen_at` y lo observado salen de corridas reales; el
    // artefacto sólo aporta ruta, fichero y navegación. Si el upsert los mandara, cada recarga —que
    // ocurre en cada corrida del gate— borraría la única prueba de que alguien usó esa pantalla, y
    // el panel diría «nadie la ha abierto» sobre una que se abre a diario.
    const { repo, screens } = build();
    await repo.replaceScreens('ADMIN_PORTAL', [{ clientCode: 'ADMIN_PORTAL', route: '/internal/flows' }] as never, 'tx' as never);
    const valores = screens.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(valores)).not.toContain('verification');
    expect(Object.keys(valores)).not.toContain('lastSeenAt');
    expect(Object.keys(valores)).not.toContain('observed');
  });
});
