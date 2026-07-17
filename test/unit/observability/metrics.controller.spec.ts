import { describe, expect, it, jest } from '@jest/globals';
import { MetricsController } from '../../../src/common/observability/metrics.controller.js';
import { MetricsService } from '../../../src/common/observability/metrics.service.js';

describe('MetricsController', () => {
  it('responde el texto de exposición Prometheus con el content-type correcto', async () => {
    const service = new MetricsService();
    service.observeHttpRequest({ method: 'GET', route: '/api/v1/health', statusCode: 200, durationSeconds: 0.01 });
    const controller = new MetricsController(service);

    const headers: Record<string, string> = {};
    let sentBody = '';
    let sentStatus = 0;
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      status: (code: number) => {
        sentStatus = code;
        return res;
      },
      send: (body: string) => {
        sentBody = body;
      },
    };

    await controller.scrape(res as never);

    expect(sentStatus).toBe(200);
    expect(headers['Content-Type']).toContain('text/plain');
    expect(sentBody).toContain('http_requests_total');
    expect(sentBody).toContain('route="/api/v1/health"');
  });
});
