import { describe, expect, it, jest } from '@jest/globals';

// Importar `tracing.js` de verdad arrastra `@opentelemetry/auto-instrumentations-node`, que al
// cargarse resuelve decenas de paquetes de instrumentación (≈60s en la suite) e instala hooks
// globales de require-in-the-middle que dejaban un worker de Jest colgado ("failed to exit
// gracefully"). Ninguno de los dos tests necesita el SDK real: uno retorna ANTES de construir el
// NodeSDK (tracing deshabilitado) y el otro nunca lo arranca. Se mockean los paquetes pesados para
// probar solo la lógica de gating/shutdown sin la carga ni el handle colgado.
jest.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: jest.fn() }));
jest.mock('@opentelemetry/auto-instrumentations-node', () => ({ getNodeAutoInstrumentations: jest.fn(() => []) }));
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: jest.fn() }));

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
