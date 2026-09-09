import {
  catalogPathFromRouteTemplate,
  freshnessFor,
  verificationFromRuns,
} from '../../src/modules/systems-ops/system-flows.verification.util.js';

const runs = (ok: number, failed: number) => ({
  ok,
  failed,
  lastAt: new Date('2026-09-09T10:00:00Z'),
  lastStatus: ok ? 200 : 500,
  statuses: { '200': ok, '500': failed },
  correlationSample: ['a', 'b', 'c', 'd', 'e', 'f'],
});

describe('verificationFromRuns', () => {
  it('sin corridas no opina: no verificado no es roto', () => {
    expect(verificationFromRuns(null, 'logs')).toBeNull();
    expect(verificationFromRuns(runs(0, 0), 'logs')).toBeNull();
  });
  it('una corrida sin 5xx verifica; sólo 5xx rompe', () => {
    expect(verificationFromRuns(runs(3, 1), 'logs')?.verification).toBe('VERIFIED');
    expect(verificationFromRuns(runs(0, 2), 'logs')?.verification).toBe('BROKEN');
  });
  it('la evidencia resume las corridas y recorta la muestra de correlación a cinco', () => {
    const outcome = verificationFromRuns(runs(3, 1), 'system_action_logs');
    expect(outcome?.evidence).toMatchObject({
      source: 'system_action_logs',
      ok: 3,
      failed: 1,
      lastStatus: 200,
      lastAt: '2026-09-09T10:00:00.000Z',
    });
    expect((outcome?.evidence.correlationSample as string[]).length).toBe(5);
  });
});

describe('catalogPathFromRouteTemplate', () => {
  it.each([
    ['/api/v1/systems/flows/:flowId', 'systems/flows/:p'],
    ['/api/v1/health/readiness', 'health/readiness'],
    ['/v1/decisions/:id/run/', 'decisions/:p/run'],
  ])('%s → %s', (template, path) => {
    expect(catalogPathFromRouteTemplate(template)).toBe(path);
  });
});

describe('freshnessFor', () => {
  it('compara el commit analizado con el desplegado, tolerando abreviaturas', () => {
    expect(freshnessFor('abc1234def', 'abc1234')).toBe('FRESH');
    expect(freshnessFor('abc1234', 'ffff000')).toBe('STALE');
    expect(freshnessFor('abc1234', undefined)).toBeNull();
    expect(freshnessFor(null, 'abc')).toBeNull();
    expect(freshnessFor('abc1234', 'local')).toBeNull();
  });
});
