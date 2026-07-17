import { afterEach, describe, expect, it } from '@jest/globals';
import { readObservabilityConfig } from '../../../src/common/observability/observability.config.js';

const KEYS = ['METRICS_ENABLED', 'OTEL_ENABLED', 'OTEL_SERVICE_NAME', 'OTEL_EXPORTER_OTLP_ENDPOINT'] as const;

describe('readObservabilityConfig', () => {
  const original: Record<string, string | undefined> = {};
  for (const key of KEYS) original[key] = process.env[key];

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('tiene defaults seguros: métricas ON, tracing OFF, servicio atlas-backend', () => {
    for (const key of KEYS) delete process.env[key];
    const config = readObservabilityConfig();
    expect(config).toEqual({
      metricsEnabled: true,
      tracingEnabled: false,
      serviceName: 'atlas-backend',
      otlpEndpoint: undefined,
    });
  });

  it('interpreta METRICS_ENABLED=false y OTEL_ENABLED=true', () => {
    process.env['METRICS_ENABLED'] = 'false';
    process.env['OTEL_ENABLED'] = 'true';
    const config = readObservabilityConfig();
    expect(config.metricsEnabled).toBe(false);
    expect(config.tracingEnabled).toBe(true);
  });

  it('acepta variantes de verdad (1/yes/on) y recorta el service name / endpoint', () => {
    process.env['OTEL_ENABLED'] = 'on';
    process.env['OTEL_SERVICE_NAME'] = '  atlas-prod  ';
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = '  http://collector:4318  ';
    const config = readObservabilityConfig();
    expect(config.tracingEnabled).toBe(true);
    expect(config.serviceName).toBe('atlas-prod');
    expect(config.otlpEndpoint).toBe('http://collector:4318');
  });

  it('trata una cadena vacía como ausente (cae al default)', () => {
    process.env['OTEL_SERVICE_NAME'] = '   ';
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = '';
    const config = readObservabilityConfig();
    expect(config.serviceName).toBe('atlas-backend');
    expect(config.otlpEndpoint).toBeUndefined();
  });
});
