import { describe, expect, it } from '@jest/globals';
import { MetricsService } from '../../../src/common/observability/metrics.service.js';

describe('MetricsService', () => {
  it('expone métricas por defecto de proceso/Node en el registro', async () => {
    const service = new MetricsService();
    const output = await service.render();
    // `collectDefaultMetrics` publica al menos estas series de proceso.
    expect(output).toContain('process_cpu_user_seconds_total');
    expect(output).toContain('nodejs_eventloop_lag_seconds');
  });

  it('registra un request HTTP en el counter y el histograma con sus labels', async () => {
    const service = new MetricsService();
    service.observeHttpRequest({ method: 'GET', route: '/api/v1/health', statusCode: 200, durationSeconds: 0.012 });

    const output = await service.render();
    expect(output).toContain('http_requests_total{');
    expect(output).toContain('method="GET"');
    expect(output).toContain('route="/api/v1/health"');
    expect(output).toContain('status_code="200"');
    // El histograma expone su suma acumulada de duración.
    expect(output).toMatch(/http_request_duration_seconds_sum\{[^}]*\}\s+0\.012/);
  });

  it('acumula múltiples requests de la misma serie', async () => {
    const service = new MetricsService();
    const labels = { method: 'POST', route: '/api/v1/events', statusCode: 201 };
    service.observeHttpRequest({ ...labels, durationSeconds: 0.1 });
    service.observeHttpRequest({ ...labels, durationSeconds: 0.2 });

    const output = await service.render();
    expect(output).toMatch(/http_requests_total\{[^}]*route="\/api\/v1\/events"[^}]*\}\s+2/);
  });

  it('render() produce el content-type de exposición Prometheus', () => {
    const service = new MetricsService();
    expect(service.contentType).toContain('text/plain');
  });

  describe('métricas de negocio (Fase 3.4)', () => {
    it('recordProviderCall cuenta llamadas por proveedor y resultado (proxy de costo)', async () => {
      const service = new MetricsService();
      service.recordProviderCall({ provider: 'INFOCENTER', outcome: 'success' });
      service.recordProviderCall({ provider: 'INFOCENTER', outcome: 'success' });
      service.recordProviderCall({ provider: 'INFOCENTER', outcome: 'failure' });

      const output = await service.render();
      expect(output).toMatch(/atlas_provider_calls_total\{[^}]*provider="INFOCENTER"[^}]*outcome="success"[^}]*\}\s+2/);
      expect(output).toMatch(/atlas_provider_calls_total\{[^}]*outcome="failure"[^}]*\}\s+1/);
    });

    it('distingue circuit_open de failure (breaker cortó: no hubo llamada ni costo)', async () => {
      const service = new MetricsService();
      service.recordProviderCall({ provider: 'SEGIP', outcome: 'circuit_open' });
      const output = await service.render();
      expect(output).toMatch(/atlas_provider_calls_total\{[^}]*outcome="circuit_open"[^}]*\}\s+1/);
    });

    it('setCircuitBreakerState codifica el estado (0=closed, 1=half_open, 2=open) para poder alertar', async () => {
      const service = new MetricsService();
      service.setCircuitBreakerState({ provider: 'A', state: 'closed' });
      service.setCircuitBreakerState({ provider: 'B', state: 'half_open' });
      service.setCircuitBreakerState({ provider: 'C', state: 'open' });

      const output = await service.render();
      expect(output).toMatch(/atlas_circuit_breaker_state\{[^}]*provider="A"[^}]*\}\s+0/);
      expect(output).toMatch(/atlas_circuit_breaker_state\{[^}]*provider="B"[^}]*\}\s+1/);
      expect(output).toMatch(/atlas_circuit_breaker_state\{[^}]*provider="C"[^}]*\}\s+2/);
    });

    it('un estado desconocido cae a 0 (closed) en vez de romper el scrape', async () => {
      const service = new MetricsService();
      service.setCircuitBreakerState({ provider: 'X', state: 'lo-que-sea' });
      const output = await service.render();
      expect(output).toMatch(/atlas_circuit_breaker_state\{[^}]*provider="X"[^}]*\}\s+0/);
    });

    it('setOutboxPendingEvents publica la profundidad del backlog por tenant', async () => {
      const service = new MetricsService();
      service.setOutboxPendingEvents({ tenantId: '1', pending: 42 });
      const output = await service.render();
      expect(output).toMatch(/atlas_outbox_pending_events\{[^}]*tenant_id="1"[^}]*\}\s+42/);
    });
  });
});
