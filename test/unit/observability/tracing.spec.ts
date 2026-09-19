import { describe, expect, it, jest } from '@jest/globals';

// Importar `tracing.js` de verdad construye el NodeSDK y las cinco instrumentaciones, que al
// arrancar instalan hooks globales de require-in-the-middle y dejaban un worker de Jest colgado
// ("failed to exit gracefully"). Ninguna de estas pruebas necesita el SDK real: comprueban el
// GATING (arrancar o no) y el cierre, no la exportación. Los spans de verdad se prueban con un
// exportador en memoria en `tracing.service.spec.ts`, que no toca la red.
jest.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: jest.fn() }));
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: jest.fn() }));

import { shutdownTracing, startTracing, stopTracing, activeTelemetryConfig } from '../../../src/observability/tracing.js';

describe('arranque del SDK de trazas', () => {
  it('es un no-op y devuelve false cuando OTEL_ENABLED no está activado', () => {
    delete process.env.OTEL_ENABLED;
    // El default seguro es cero impacto: ni exportador, ni parcheo, ni conexiones de fondo.
    expect(startTracing('atlas-test')).toBe(false);
    expect(activeTelemetryConfig()).toBeUndefined();
  });

  it('sigue apagado con un valor que no es una afirmación explícita', () => {
    process.env.OTEL_ENABLED = 'quizá';
    expect(startTracing('atlas-test')).toBe(false);
    delete process.env.OTEL_ENABLED;
  });

  it('stopTracing resuelve sin error aunque el SDK nunca se haya arrancado', async () => {
    await expect(stopTracing()).resolves.toBeUndefined();
  });

  it('shutdownTracing es el mismo cierre, conservado por los tres entrypoints', () => {
    expect(shutdownTracing).toBe(stopTracing);
  });
});
