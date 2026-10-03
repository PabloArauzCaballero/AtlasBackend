import { describe, expect, it } from '@jest/globals';
import {
  criticalToolsStatus,
  networkStatus,
  outcomesStatus,
  providersStatus,
  reviewQueueStatus,
  trafficStatus,
  worstStatus,
} from '../../../src/modules/systems-ops/systems-monitor.rules.js';

describe('systems-monitor.rules', () => {
  it('worstStatus: el peor gana y unknown sólo si no hay datos', () => {
    expect(worstStatus(['ok', 'warn', 'ok'])).toBe('warn');
    expect(worstStatus(['ok', 'bad', 'warn'])).toBe('bad');
    expect(worstStatus(['unknown', 'ok'])).toBe('ok');
    expect(worstStatus(['unknown', 'unknown'])).toBe('unknown');
    expect(worstStatus([])).toBe('unknown');
  });

  it('networkStatus sigue los colores del portal', () => {
    expect(networkStatus('DOWN')).toBe('bad');
    expect(networkStatus('DEGRADED')).toBe('warn');
    expect(networkStatus('UP')).toBe('ok');
    expect(networkStatus('NOT_CONFIGURED')).toBe('unknown');
  });

  it('criticalToolsStatus ignora las no críticas y las que no tienen sonda', () => {
    expect(criticalToolsStatus([])).toBe('unknown');
    expect(criticalToolsStatus([{ isCritical: true, isHealthy: null }])).toBe('unknown');
    expect(criticalToolsStatus([{ isCritical: false, isHealthy: false }])).toBe('unknown');
    expect(
      criticalToolsStatus([
        { isCritical: true, isHealthy: true },
        { isCritical: false, isHealthy: false },
      ]),
    ).toBe('ok');
    expect(
      criticalToolsStatus([
        { isCritical: true, isHealthy: true },
        { isCritical: true, isHealthy: false },
      ]),
    ).toBe('bad');
  });

  it('trafficStatus: error >2 % rojo, p95 >2 s ámbar, pocas peticiones sin datos', () => {
    expect(trafficStatus({ totalRequests: 5, serverErrorRate: 1, p95LatencyMs: 9000 })).toBe('unknown');
    expect(trafficStatus({ totalRequests: 100, serverErrorRate: 0.021, p95LatencyMs: 100 })).toBe('bad');
    expect(trafficStatus({ totalRequests: 100, serverErrorRate: 0.02, p95LatencyMs: 100 })).toBe('ok');
    expect(trafficStatus({ totalRequests: 100, serverErrorRate: 0, p95LatencyMs: 2001 })).toBe('warn');
    expect(trafficStatus({ totalRequests: 100, serverErrorRate: 0.5, p95LatencyMs: 2001 })).toBe('bad');
  });

  it('providersStatus: éxito en porcentaje, 95/80, y respondientes', () => {
    const base = { providers: 8, respondingProviders: 8, unmeasuredProviders: 0 };
    expect(providersStatus({ ...base, successRate: 99 })).toBe('ok');
    expect(providersStatus({ ...base, successRate: 95 })).toBe('ok');
    expect(providersStatus({ ...base, successRate: 90 })).toBe('warn');
    expect(providersStatus({ ...base, successRate: 79.9 })).toBe('bad');
    expect(providersStatus({ ...base, respondingProviders: 7, successRate: 99 })).toBe('warn');
    expect(providersStatus({ providers: 0, respondingProviders: 0, unmeasuredProviders: 0, successRate: null })).toBe('unknown');
    expect(providersStatus({ providers: 4, respondingProviders: 0, unmeasuredProviders: 4, successRate: null })).toBe('unknown');
    // Los no medidos no acusan a nadie: 3 de 3 medidos responden aunque haya 1 sin medir.
    expect(providersStatus({ providers: 4, respondingProviders: 3, unmeasuredProviders: 1, successRate: 100 })).toBe('ok');
  });

  it('outcomesStatus: agotados rojo, reintentando ámbar, sin configurar sin datos', () => {
    expect(outcomesStatus({ configured: false, exhausted: 9, retrying: 9 })).toBe('unknown');
    expect(outcomesStatus({ configured: true, exhausted: 1, retrying: 0 })).toBe('bad');
    expect(outcomesStatus({ configured: true, exhausted: 0, retrying: 2 })).toBe('warn');
    expect(outcomesStatus({ configured: true, exhausted: 0, retrying: 0 })).toBe('ok');
  });

  it('reviewQueueStatus: ámbar pasadas 24 h', () => {
    expect(reviewQueueStatus(null)).toBe('ok');
    expect(reviewQueueStatus(24)).toBe('ok');
    expect(reviewQueueStatus(24.1)).toBe('warn');
  });
});
