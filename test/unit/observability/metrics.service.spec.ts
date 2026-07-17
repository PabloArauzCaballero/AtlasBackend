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
});
