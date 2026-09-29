import { SystemFlowsGateService } from '../../src/modules/systems-ops/system-flows.gate.service.js';

/**
 * FLOW_DOCUMENTATION_GATE decide si se puede certificar. Lo que se protege es que nunca pase sobre lo
 * que no se ha podido mirar, y que cada comprobación diga cuánto falta.
 */
const todasLasCargas = new Set([
  ...['ATLAS_BACKEND', 'DECISION_ENGINE', 'ERP_BACKEND', 'DASHBOARDS'].map((b) => `endpoints:${b}`),
  ...['ATLAS_BACKEND', 'DECISION_ENGINE', 'ERP_BACKEND', 'DASHBOARDS'].map((b) => `findings:${b}`),
  ...['ADMIN_PORTAL', 'CONSUMER_APP', 'ERP_PORTAL', 'MOTOR_PORTAL', 'DASHBOARDS_PORTAL'].map((c) => `screens:${c}`),
]);

function servicio(
  over: {
    criticos?: unknown[];
    desprotegidas?: number;
    pendientes?: number;
    cargas?: Set<string>;
    deriva?: Record<string, unknown>;
    sinCablear?: Array<{ workflowCode: string; count: number }>;
  } = {},
) {
  return new SystemFlowsGateService(
    {
      criticalNotCertified: async () => over.criticos ?? [],
      openFindingsOfKind: async () => over.desprotegidas ?? 0,
      unresolvedHighReviews: async () => over.pendientes ?? 0,
      importedScopes: async () => over.cargas ?? todasLasCargas,
      unwiredProcessSteps: async () => over.sinCablear ?? [],
    } as never,
    {
      rbacDrift: async () => ({
        screensWithObservedEdges: 5,
        truncated: false,
        notMeasured: [],
        screens: [],
        catalogMeasured: true,
        summary: { bySeverity: { PERMISO_FUERA_DEL_CATALOGO: 0, MENU_PERMISO_DISTINTO: 0 } },
        ...over.deriva,
      }),
    } as never,
  );
}
const check = (resultado: { checks: Array<{ code: string; passed: boolean; count: number; detail: string }> }, code: string) =>
  resultado.checks.find((c) => c.code === code);

describe('SystemFlowsGateService', () => {
  it('pasa sólo si pasan todas', async () => {
    expect((await servicio().evaluate()).passed).toBe(true);
  });

  it('CRITICAL sin verificar sobre su código actual bloquea, con la cifra por bloque', async () => {
    const resultado = await servicio({
      criticos: [
        { systemCode: 'ATLAS_BACKEND', count: 100 },
        { systemCode: 'ERP_BACKEND', count: '22' },
      ],
    }).evaluate();
    expect(resultado.passed).toBe(false);
    expect(check(resultado, 'CRITICAL_VERIFIED')).toMatchObject({
      passed: false,
      count: 122,
      detail: expect.stringContaining('ATLAS_BACKEND 100'),
    });
  });

  it('sin uso observado la deriva NO pasa: no se afirma lo que no se ha podido mirar', async () => {
    const resultado = await servicio({ deriva: { screensWithObservedEdges: 0 } }).evaluate();
    expect(check(resultado, 'RBAC_DRIFT_SIN_GUARDA')).toMatchObject({
      passed: false,
      detail: expect.stringContaining('sin uso observado'),
    });
  });

  it('una llamada sin guarda bloquea; sólo rol no', async () => {
    const pantallas = [{ calls: [{ severity: 'SIN_GUARDA' }, { severity: 'SOLO_ROL' }] }];
    expect(check(await servicio({ deriva: { screens: pantallas } }).evaluate(), 'RBAC_DRIFT_SIN_GUARDA')).toMatchObject({
      passed: false,
      count: 1,
    });
    expect(
      check(await servicio({ deriva: { screens: [{ calls: [{ severity: 'SOLO_ROL' }] }] } }).evaluate(), 'RBAC_DRIFT_SIN_GUARDA'),
    ).toMatchObject({ passed: true });
  });

  it('un permiso que la base no tiene o un menú que pide otro permiso bloquean, con la cifra', async () => {
    const resultado = await servicio({
      deriva: { summary: { bySeverity: { PERMISO_FUERA_DEL_CATALOGO: 1, MENU_PERMISO_DISTINTO: 2 } } },
    }).evaluate();
    expect(resultado.passed).toBe(false);
    expect(check(resultado, 'RBAC_DRIFT_BLOQUEA_USUARIOS')).toMatchObject({ passed: false, measured: true, count: 3 });
  });

  it('sin catálogo de permisos en la base la comprobación queda sin medir', async () => {
    expect(check(await servicio({ deriva: { catalogMeasured: false } }).evaluate(), 'RBAC_DRIFT_BLOQUEA_USUARIOS')).toMatchObject({
      passed: false,
      measured: false,
    });
  });

  it('un permiso fuera del catálogo se afirma aunque no haya uso observado; «cero» sin uso, no', async () => {
    const sinUso = { screensWithObservedEdges: 0 };
    expect(check(await servicio({ deriva: sinUso }).evaluate(), 'RBAC_DRIFT_BLOQUEA_USUARIOS')).toMatchObject({ measured: false });
    const conFuera = { ...sinUso, summary: { bySeverity: { PERMISO_FUERA_DEL_CATALOGO: 1, MENU_PERMISO_DISTINTO: 0 } } };
    expect(check(await servicio({ deriva: conFuera }).evaluate(), 'RBAC_DRIFT_BLOQUEA_USUARIOS')).toMatchObject({
      passed: false,
      measured: true,
      count: 1,
    });
  });

  it('una consulta de deriva cortada no pasa aunque no vea llamadas sin guarda', async () => {
    expect(check(await servicio({ deriva: { truncated: true } }).evaluate(), 'RBAC_DRIFT_SIN_GUARDA')?.passed).toBe(false);
  });

  it('escrituras desprotegidas y revisiones pendientes de riesgo alto bloquean', async () => {
    const resultado = await servicio({ desprotegidas: 10, pendientes: 3 }).evaluate();
    expect(check(resultado, 'UNPROTECTED_WRITE_OPEN')).toMatchObject({ passed: false, count: 10 });
    expect(check(resultado, 'REVIEW_PENDING_HIGH')).toMatchObject({ passed: false, count: 3 });
  });

  it('dice qué artefacto falta cargar', async () => {
    const cargas = new Set([...todasLasCargas].filter((c) => c !== 'screens:DASHBOARDS_PORTAL'));
    expect(check(await servicio({ cargas }).evaluate(), 'ARTIFACTS_PRESENT')).toMatchObject({
      passed: false,
      count: 1,
      detail: expect.stringContaining('pantallas de DASHBOARDS_PORTAL'),
    });
  });

  it('la deriva no pasa mientras haya portales cuya deriva no se mide', async () => {
    const resultado = await servicio({ deriva: { notMeasured: ['ERP_PORTAL'] } }).evaluate();
    expect(check(resultado, 'RBAC_DRIFT_SIN_GUARDA')).toMatchObject({
      passed: false,
      detail: expect.stringContaining('no se mide para ERP_PORTAL'),
    });
  });

  it('sin hallazgos cargados de un bloque no pasa: «0 abiertos» no diría nada', async () => {
    const cargas = new Set([...todasLasCargas].filter((c) => c !== 'findings:ERP_BACKEND'));
    expect(check(await servicio({ cargas }).evaluate(), 'ARTIFACTS_PRESENT')).toMatchObject({
      passed: false,
      detail: expect.stringContaining('hallazgos de ERP_BACKEND'),
    });
  });

  it('un paso de persona sin pantalla en un proceso P0/P1 bloquea, con el proceso y la cifra', async () => {
    const resultado = await servicio({ sinCablear: [{ workflowCode: 'credit_line_and_application', count: 4 }] }).evaluate();
    expect(resultado.passed).toBe(false);
    const procesos = check(resultado, 'PROCESS_STEPS_WIRED')!;
    expect(procesos).toMatchObject({ passed: false, count: 4 });
    expect(procesos.detail).toContain('credit_line_and_application (4)');
  });

  it('en un entorno recién desplegado (nada cargado) ninguna comprobación pasa: todas dicen «sin medir»', async () => {
    const resultado = await servicio({ cargas: new Set(), deriva: { screensWithObservedEdges: 0 } }).evaluate();
    expect(resultado.passed).toBe(false);
    expect(resultado.artifactsLoaded).toBe(false);
    for (const code of [
      'CRITICAL_VERIFIED',
      'UNPROTECTED_WRITE_OPEN',
      'RBAC_DRIFT_SIN_GUARDA',
      'RBAC_DRIFT_BLOQUEA_USUARIOS',
      'REVIEW_PENDING_HIGH',
      'PROCESS_STEPS_WIRED',
    ]) {
      expect(check(resultado, code)).toMatchObject({ passed: false, measured: false });
    }
    expect(check(resultado, 'CRITICAL_VERIFIED')?.detail).toMatch(/^sin medir: falta cargar endpoints de ATLAS_BACKEND/);
    // La única que sí se mide es la que dice qué falta cargar.
    expect(check(resultado, 'ARTIFACTS_PRESENT')).toMatchObject({ passed: false, measured: true, count: 13 });
  });

  it('0 escrituras desprotegidas NO pasa si falta cargar los hallazgos de un bloque, y avisa de que la cifra es parcial', async () => {
    const cargas = new Set([...todasLasCargas].filter((c) => c !== 'findings:DASHBOARDS'));
    const desprotegidas = check(await servicio({ cargas }).evaluate(), 'UNPROTECTED_WRITE_OPEN');
    expect(desprotegidas).toMatchObject({ passed: false, measured: false, count: 0 });
    expect(desprotegidas?.detail).toContain('hallazgos de DASHBOARDS (la cifra cubre sólo lo cargado)');
  });

  it('pasos sin pantalla no acusan a los procesos si faltan los endpoints: queda sin medir', async () => {
    const cargas = new Set([...todasLasCargas].filter((c) => !c.startsWith('endpoints:')));
    const procesos = check(await servicio({ cargas, sinCablear: [{ workflowCode: 'x', count: 87 }] }).evaluate(), 'PROCESS_STEPS_WIRED');
    expect(procesos).toMatchObject({ passed: false, measured: false });
  });

  it('con todo cargado, cada comprobación se declara medida', async () => {
    const resultado = await servicio().evaluate();
    expect(resultado.artifactsLoaded).toBe(true);
    expect(resultado.checks.every((c) => (c as { measured?: boolean }).measured)).toBe(true);
  });
});
