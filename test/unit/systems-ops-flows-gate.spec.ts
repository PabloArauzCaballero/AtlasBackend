import { SystemFlowsGateService } from '../../src/modules/systems-ops/system-flows.gate.service.js';

/**
 * FLOW_DOCUMENTATION_GATE decide si se puede certificar. Lo que se protege es que nunca pase sobre lo
 * que no se ha podido mirar, y que cada comprobación diga cuánto falta.
 */
const todasLasCargas = new Set([
  ...['ATLAS_BACKEND', 'DECISION_ENGINE', 'ERP_BACKEND', 'DASHBOARDS'].map((b) => `endpoints:${b}`),
  ...['ADMIN_PORTAL', 'CONSUMER_APP', 'ERP_PORTAL', 'MOTOR_PORTAL', 'DASHBOARDS_PORTAL'].map((c) => `screens:${c}`),
]);

function servicio(
  over: { criticos?: unknown[]; desprotegidas?: number; pendientes?: number; cargas?: Set<string>; deriva?: Record<string, unknown> } = {},
) {
  return new SystemFlowsGateService(
    {
      criticalNotCertified: async () => over.criticos ?? [],
      openFindingsOfKind: async () => over.desprotegidas ?? 0,
      pendingHighReviews: async () => over.pendientes ?? 0,
      importedScopes: async () => over.cargas ?? todasLasCargas,
    } as never,
    { rbacDrift: async () => ({ screensWithObservedEdges: 5, truncated: false, notMeasured: [], screens: [], ...over.deriva }) } as never,
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
});
