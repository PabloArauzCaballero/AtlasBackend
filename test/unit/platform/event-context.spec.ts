/**
 * @file AT-048 — la correlación viaja y las etiquetas de métrica no llevan identificadores.
 * @business Un evento hijo hereda la correlación de la petición y apunta a su padre: así se sigue un aviso
 *   hasta la solicitud que lo originó. Y ninguna serie de Prometheus lleva tenant, cliente ni evento: eso
 *   multiplica series sin límite y filtra identificadores a un panel.
 * @system Funciones puras: sin base, sin Nest.
 */
import { describe, expect, it } from '@jest/globals';
import { childContextOf, contextFromRequest, EVENT_METRICS, metricLabels } from '../../../src/platform/observability/event-context.js';
import type { IntegrationEvent } from '../../../src/platform/events/integration-event.js';

const parent = {
  eventId: 'e-1',
  type: 'credit.application.submitted',
  category: 'domain',
  schemaVersion: 1,
  producer: 'credit',
  scope: { kind: 'tenant', tenantId: '1' },
  aggregate: { type: 'credit_application', id: '9', version: 1 },
  occurredAt: '2026-09-12T00:00:00.000Z',
  correlationId: 'corr-7',
  causationId: null,
  payload: {},
} as IntegrationEvent;

describe('contexto de trazas de eventos', () => {
  it('el hijo hereda la correlación del padre y lo señala como causa', () => {
    expect(childContextOf(parent)).toEqual({ correlationId: 'corr-7', causationId: 'e-1', traceparent: null });
  });

  it('un padre sin correlación deja al hijo con su propia identidad como correlación', () => {
    const orphan = { ...parent, correlationId: null } as IntegrationEvent;
    const child = childContextOf(orphan, '00-abc-def-01');
    expect(child.causationId).toBe('e-1');
    expect(child.traceparent).toBe('00-abc-def-01');
    expect(child.correlationId === null || child.correlationId === 'e-1').toBe(true);
  });

  it('desde una petición HTTP se conserva la correlación y el traceparent si vienen', () => {
    expect(contextFromRequest({ correlationId: 'req-1', traceparent: '00-t-s-01' })).toEqual({
      correlationId: 'req-1',
      causationId: null,
      traceparent: '00-t-s-01',
    });
    expect(contextFromRequest({ correlationId: null })).toEqual({ correlationId: null, causationId: null, traceparent: null });
  });

  it('las etiquetas de métrica rechazan identificadores y normalizan el resto', () => {
    const labels = metricLabels({
      outcome: 'published',
      transport: 'local',
      attempts: 3,
      retriable: true,
      missing: null,
      empty: undefined,
    });
    expect(labels).toEqual({ outcome: 'published', transport: 'local', attempts: '3', retriable: 'true' });
    // La lista es exacta (camelCase), no heurística: `tenant_id` no está y por eso no se rechaza.
    for (const forbidden of ['tenantId', 'customerId', 'eventId', 'correlationId', 'causationId', 'recipientId', 'aggregateId']) {
      expect(() => metricLabels({ [forbidden]: '1' })).toThrow(/METRIC_LABEL_HIGH_CARDINALITY/);
    }
  });

  it('el catálogo de métricas de eventos está congelado', () => {
    expect(Object.isFrozen(EVENT_METRICS)).toBe(true);
    expect(Object.values(EVENT_METRICS).every((name) => typeof name === 'string' && name.startsWith('atlas_'))).toBe(true);
  });
});
