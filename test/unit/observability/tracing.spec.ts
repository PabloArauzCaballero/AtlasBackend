import { describe, expect, it } from '@jest/globals';
import { shutdownTracing, startTracing } from '../../../src/observability/tracing.js';
import { ObservabilityConfig } from '../../../src/common/observability/observability.config.js';

const disabled: ObservabilityConfig = {
  metricsEnabled: true,
  tracingEnabled: false,
  serviceName: 'atlas-test',
  otlpEndpoint: undefined,
};

describe('tracing bootstrap', () => {
  it('startTracing es un no-op (devuelve false) cuando OTEL está deshabilitado', () => {
    // No debe construir ni arrancar el NodeSDK — el default seguro es cero impacto.
    expect(startTracing(disabled)).toBe(false);
  });

  it('shutdownTracing resuelve sin error aunque el SDK nunca se haya arrancado', async () => {
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });
});
