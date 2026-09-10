import { flowRowFor, mapFinding, mapFlow, mapScreen, summarizeAnalysis } from '../../src/modules/systems-ops/system-flows.mapper.js';
import { DerivedEndpointDto } from '../../src/modules/systems-ops/system-flows.schemas.js';

/**
 * Mapeadores puros de Flujos: fila de base ↔ DTO, y endpoint derivado → fila del catálogo.
 * No tocan la base de datos, así que lo que se protege aquí es la forma exacta del contrato:
 * qué campos calculados salen, y cómo se comporta cada uno en sus bordes (sin análisis,
 * análisis de fase 1, ruta sin barra inicial, etc.).
 */

const endpoint = (over: Partial<DerivedEndpointDto> = {}): DerivedEndpointDto =>
  ({
    method: 'GET',
    path: 'auth/me',
    module: 'auth',
    controller: 'AuthController',
    handler: 'me',
    isPublic: false,
    roles: [],
    internalPermissions: [],
    guards: [],
    callers: [],
    testStatus: 'UNTESTED',
    contractStatus: 'NO_CONTRACT',
    ...over,
  }) as DerivedEndpointDto;

describe('summarizeAnalysis', () => {
  it('un análisis vacío ({}) no es la fase 2: no tiene `status` y la ficha no debe fingir que sí', () => {
    expect(summarizeAnalysis({})).toBeNull();
  });

  it('null no revienta: la fila puede llegar sin `analysisJson` todavía', () => {
    expect(summarizeAnalysis(null as unknown as Record<string, unknown>)).toBeNull();
  });

  it('una forma antigua sin `status` (de antes de la fase 2) se trata como ausencia de análisis', () => {
    expect(summarizeAnalysis({ chain: [], writes: [] })).toBeNull();
  });

  it('con análisis completo, resume sin mandar la cadena entera: sólo el conteo y hasta 20 servicios únicos', () => {
    const chain = Array.from({ length: 25 }, (_, i) => ({
      kind: 'SERVICE' as const,
      class: `Service${i % 3}`,
      method: 'run',
      file: 'x.ts',
      line: 1,
      depth: 0,
    }));
    const resumen = summarizeAnalysis({
      status: 'MAPPED',
      chain,
      reads: ['customers'],
      writes: [{ table: 'customers', op: 'UPDATE', via: 'sequelize' }],
      errors: ['boom'],
      blockCalls: [],
      unknowns: Array.from({ length: 15 }, (_, i) => ({ reason: `r${i}`, at: 'x' })),
      transactional: true,
    });
    expect(resumen).toMatchObject({ status: 'MAPPED', chainLength: 25, transactional: true });
    // 25 pasos con sólo 3 nombres de clase distintos: los duplicados no cuentan dos veces.
    expect(resumen?.services).toHaveLength(3);
    // El tope de 10 unknowns está para no mandar un listado sin fin a la ficha.
    expect(resumen?.unknowns).toHaveLength(10);
  });

  it('cuando el paso no tiene `class`, usa el `method` como identificador de servicio', () => {
    const resumen = summarizeAnalysis({
      status: 'PARTIAL',
      chain: [{ kind: 'FUNCTION', class: null, method: 'helper', file: 'x.ts', line: 1, depth: 0 }],
      reads: [],
      writes: [],
      errors: [],
      blockCalls: [],
      unknowns: [],
      transactional: false,
    });
    expect(resumen?.services).toEqual(['helper']);
  });
});

describe('mapFlow', () => {
  it('antepone la barra a la ruta: la fila la guarda sin ella pero el DTO la expone como se navega', () => {
    const row = { path: 'auth/me', analysisJson: {} } as never;
    expect(mapFlow(row).path).toBe('/auth/me');
  });

  it('incrusta el resumen del análisis, no el JSON crudo de la columna', () => {
    const row = {
      path: 'x',
      analysisJson: { status: 'MAPPED', chain: [], reads: [], writes: [], errors: [], blockCalls: [], unknowns: [], transactional: false },
    } as never;
    expect(mapFlow(row).analysis).toMatchObject({ status: 'MAPPED', chainLength: 0 });
  });

  it('sin análisis, la ficha lo declara nulo en vez de omitir el campo', () => {
    const row = { path: 'x', analysisJson: {} } as never;
    const mapped = mapFlow(row);
    expect(mapped).toHaveProperty('analysis', null);
  });
});

describe('mapScreen', () => {
  it('sólo expone los campos de navegación y su verificación, sin arrastrar nada del catálogo de flujos', () => {
    const row = {
      clientCode: 'ADMIN_PORTAL',
      route: '/internal/flows',
      sourceFile: 'Flows.tsx',
      navLabel: 'Flujos',
      navPermissions: ['flows.read'],
      navRoles: ['ADMIN'],
      analyzedCommit: 'abc1234',
      verification: 'VERIFIED',
      verifiedAt: new Date('2026-09-10T10:00:00Z'),
      lastSeenAt: new Date('2026-09-10T09:00:00Z'),
      observed: { calls: 3 },
    } as never;
    expect(mapScreen(row)).toEqual({
      clientCode: 'ADMIN_PORTAL',
      route: '/internal/flows',
      sourceFile: 'Flows.tsx',
      navLabel: 'Flujos',
      navPermissions: ['flows.read'],
      navRoles: ['ADMIN'],
      analyzedCommit: 'abc1234',
      verification: 'VERIFIED',
      verifiedAt: new Date('2026-09-10T10:00:00Z'),
      lastSeenAt: new Date('2026-09-10T09:00:00Z'),
      observed: { calls: 3 },
    });
  });

  it('una pantalla que nadie ha abierto sale con lo observado VACÍO, no nulo', () => {
    // Un `{}` se lee como «no consta que se haya usado». Un nulo obliga a quien pinta la ficha a
    // decidir qué significa, y esa decisión acaba siendo «no llama a nada», que es otra cosa.
    const row = { clientCode: 'ERP_PORTAL', route: '/x', verification: 'UNVERIFIED' } as never;
    expect(mapScreen(row)).toMatchObject({ verification: 'UNVERIFIED', observed: {} });
  });
});

describe('mapFinding', () => {
  it('renombra la clave interna (`findingKey`, `extraJson`, `updatedAtValue`) al nombre público del DTO', () => {
    const updatedAt = new Date('2026-09-09T00:00:00Z');
    const row = {
      id: '1',
      findingKey: 'k1',
      kind: 'CONTRACT_DRIFT',
      severity: 'HIGH',
      systemCode: 'ATLAS_BACKEND',
      ref: 'POST auth/login',
      module: 'auth',
      summary: 'x',
      extraJson: { detail: 1 },
      knownSince: null,
      status: 'open',
      updatedAtValue: updatedAt,
    } as never;
    expect(mapFinding(row)).toEqual({
      id: '1',
      key: 'k1',
      kind: 'CONTRACT_DRIFT',
      severity: 'HIGH',
      systemCode: 'ATLAS_BACKEND',
      ref: 'POST auth/login',
      module: 'auth',
      summary: 'x',
      extra: { detail: 1 },
      knownSince: null,
      status: 'open',
      updatedAt,
    });
  });
});

describe('flowRowFor', () => {
  const meta = { analyzedCommit: 'abc1234', analyzedBranch: 'dev', importId: '7' };

  it('sin análisis (fase 1), el riesgo sale del módulo y `riskBasis` lo declara: `module-heuristic`', () => {
    const row = flowRowFor('ATLAS_BACKEND', endpoint({ module: 'auth', method: 'GET', path: 'auth/me' }), meta);
    expect(row.riskBasis).toBe('module-heuristic');
    expect(row.discovery).toBe('DISCOVERED');
    expect(row.analysisJson).toEqual({});
    expect(row.reads).toEqual([]);
    expect(row.writes).toEqual([]);
  });

  it('un análisis con status DISCOVERED cuenta igual que no tener análisis: fase 2 exige más que el registro mínimo', () => {
    const row = flowRowFor(
      'ATLAS_BACKEND',
      endpoint({
        module: 'auth',
        analysis: {
          status: 'DISCOVERED',
          chain: [],
          reads: [],
          writes: [],
          errors: [],
          blockCalls: [],
          unknowns: [],
          transactional: false,
        },
      }),
      meta,
    );
    expect(row.riskBasis).toBe('module-heuristic');
  });

  it('con análisis MAPPED, el riesgo sale de las tablas escritas y `riskBasis` es `tables-written`', () => {
    const row = flowRowFor(
      'ATLAS_BACKEND',
      endpoint({
        method: 'POST',
        path: 'loans',
        module: 'loans',
        isPublic: true,
        analysis: {
          status: 'MAPPED',
          chain: [],
          reads: ['customers'],
          writes: [
            { table: 'loans', op: 'INSERT', via: 'sequelize' },
            { table: 'loans', op: 'UPDATE', via: 'sequelize' },
          ],
          errors: [],
          blockCalls: [],
          unknowns: [],
          transactional: true,
        },
      }),
      meta,
    );
    expect(row.riskBasis).toBe('tables-written');
    expect(row.risk).toBe('CRITICAL');
    // Tablas escritas: únicas y ordenadas, no la lista cruda con repetidos.
    expect(row.writes).toEqual(['loans']);
    expect(row.reads).toEqual(['customers']);
    expect(row.discovery).toBe('MAPPED');
  });

  it('lleva la identidad, el commit y la rama de la carga tal cual, sin recalcularlos', () => {
    const row = flowRowFor('ATLAS_BACKEND', endpoint(), meta);
    expect(row.analyzedCommit).toBe('abc1234');
    expect(row.analyzedBranch).toBe('dev');
    expect(row.importId).toBe('7');
    expect(row.findingsCount).toBe(0);
    expect(row.verification).toBe('UNVERIFIED');
    expect(row.freshness).toBe('FRESH');
  });

  it('sin commit ni rama en la carga, quedan null y no "undefined": la columna no debe mentir con un valor ausente', () => {
    const row = flowRowFor('ATLAS_BACKEND', endpoint(), { importId: null });
    expect(row.analyzedCommit).toBeNull();
    expect(row.analyzedBranch).toBeNull();
  });
});

describe('flowRowFor · un análisis a medias no finge estar medido', () => {
  /**
   * Lo señaló la revisión: un `PARTIAL` que no llegó a ninguna tabla producía `risk: 'LOW'` con
   * `riskBasis: 'tables-written'`. Suena a medido y no lo está: son 62 de los 81 PARTIAL del
   * Backend. Con cero tablas conocidas se vuelve a la heurística de módulo, que declara lo que es.
   */
  const base = {
    method: 'POST',
    path: 'loans/:p/payments',
    module: 'loans',
    controller: 'LoansController',
    handler: 'pay',
    isPublic: false,
    roles: ['admin'],
    internalPermissions: [],
    guards: [],
    callers: [],
    testStatus: 'UNTESTED' as const,
    contractStatus: 'IN_CONTRACT' as const,
  };
  const analisis = (over: Record<string, unknown> = {}) => ({
    status: 'PARTIAL' as const,
    chain: [],
    reads: [],
    writes: [],
    errors: [],
    blockCalls: [],
    unknowns: [{ reason: 'RAW_SQL_DYNAMIC', at: 'x.ts:1' }],
    transactional: false,
    ...over,
  });

  it('PARTIAL sin ninguna tabla vuelve a la heurística de módulo', () => {
    const row = flowRowFor('ATLAS_BACKEND', { ...base, analysis: analisis() } as never, { importId: null });
    expect(row.riskBasis).toBe('module-heuristic');
    // Escribir en `loans` es CRITICAL por módulo; con `tables-written` y cero tablas saldría LOW.
    expect(row.risk).toBe('CRITICAL');
  });

  it('PARTIAL que sí resolvió tablas sigue midiendo por ellas', () => {
    const row = flowRowFor(
      'ATLAS_BACKEND',
      { ...base, analysis: analisis({ writes: [{ table: 'loan_payments', op: 'INSERT', via: 'SEQUELIZE' }] }) } as never,
      { importId: null },
    );
    expect(row.riskBasis).toBe('tables-written');
  });

  it('PARTIAL con sólo lecturas también mide: leer identidad no es no saber nada', () => {
    const row = flowRowFor(
      'ATLAS_BACKEND',
      { ...base, method: 'GET', analysis: analisis({ reads: ['customer_identity_documents'] }) } as never,
      { importId: null },
    );
    expect(row.riskBasis).toBe('tables-written');
  });
});

describe('exposición del código fuente', () => {
  /**
   * `sourceFile` y `sourceLine` son el atajo del hallazgo al código, y a la vez el árbol de fuentes
   * de los cuatro bloques servido por HTTP a quien tenga una sesión con `systems.flows.read`. En
   * producción el valor cae —nadie abre el editor desde ahí— y el coste no, así que el defecto
   * depende del entorno. Aquí se fija que la bandera de verdad manda, en los dos sentidos.
   */
  const conBandera = async (valor: boolean) => {
    jest.resetModules();
    jest.doMock('../../src/config/env.js', () => ({ env: { FLOWS_EXPOSE_SOURCE: valor } }));
    return import('../../src/modules/systems-ops/system-flows.mapper.js');
  };

  afterEach(() => jest.resetModules());

  it('con la bandera apagada no salen ni el fichero ni la línea', async () => {
    const { mapFlow, mapScreen } = await conBandera(false);
    const flujo = mapFlow({ tables: {}, analysis: null, sourceFile: 'a.ts', sourceLine: 12 } as never);
    expect(flujo).toMatchObject({ sourceFile: null, sourceLine: null });
    expect(mapScreen({ sourceFile: 'Pantalla.tsx' } as never)).toMatchObject({ sourceFile: null });
  });

  it('con la bandera encendida salen tal cual', async () => {
    const { mapFlow } = await conBandera(true);
    expect(mapFlow({ tables: {}, analysis: null, sourceFile: 'a.ts', sourceLine: 12 } as never)).toMatchObject({
      sourceFile: 'a.ts',
      sourceLine: 12,
    });
  });
});
