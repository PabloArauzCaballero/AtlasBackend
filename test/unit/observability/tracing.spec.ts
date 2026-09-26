import { afterEach, describe, expect, it, jest } from '@jest/globals';

// Importar `tracing.js` de verdad construye el NodeSDK y las cinco instrumentaciones, que al
// arrancar instalan hooks globales de require-in-the-middle y dejaban un worker de Jest colgado
// ("failed to exit gracefully"). Ninguna de estas pruebas necesita el SDK real: comprueban el
// GATING (arrancar o no) y el cierre, no la exportación. Los spans de verdad se prueban con un
// exportador en memoria en `tracing.service.spec.ts`, que no toca la red.
// El doble devuelve `start`/`shutdown` porque las pruebas de señales SÍ recorren el arranque
// completo; sigue sin tocar la red ni instalar hooks globales.
jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn(async () => undefined),
  })),
}));
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

  describe('señales que este backend no exporta', () => {
    /**
     * `NodeSDK` arranca un proveedor de MÉTRICAS y otro de REGISTROS cuando sus variables no
     * están declaradas: su valor por defecto es `otlp`, no `none`. Medido el 2026-09-19 con
     * Jaeger de destino, eso producía un `OTLPExporterError: Not Found` cada minuto y, peor,
     * una señal que sale del proceso sin pasar por `RedactingSpanProcessor`.
     */
    afterEach(async () => {
      await stopTracing();
      delete process.env.OTEL_ENABLED;
      delete process.env.OTEL_METRICS_EXPORTER;
      delete process.env.OTEL_LOGS_EXPORTER;
    });

    it('declara `none` en métricas y registros al arrancar con la telemetría encendida', () => {
      process.env.OTEL_ENABLED = 'true';
      expect(startTracing('atlas-test-senales')).toBe(true);
      expect(process.env.OTEL_METRICS_EXPORTER).toBe('none');
      expect(process.env.OTEL_LOGS_EXPORTER).toBe('none');
    });

    it('no pisa la decisión de un operador que sí declaró un exportador', () => {
      process.env.OTEL_METRICS_EXPORTER = 'prometheus';
      process.env.OTEL_ENABLED = 'true';
      expect(startTracing('atlas-test-senales-2')).toBe(true);
      expect(process.env.OTEL_METRICS_EXPORTER).toBe('prometheus');
    });
  });
});
