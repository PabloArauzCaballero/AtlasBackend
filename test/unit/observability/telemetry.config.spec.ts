import { describe, expect, it } from '@jest/globals';
import { readTelemetryConfig } from '../../../src/observability/telemetry.config.js';

/** Un entorno limpio: evita que las variables de la máquina que corre las pruebas se cuelen. */
const vacio: NodeJS.ProcessEnv = {};

describe('lectura de la configuración de telemetría', () => {
  it('apagada por defecto: el silencio NO habilita la exportación', () => {
    expect(readTelemetryConfig(vacio).enabled).toBe(false);
  });

  it.each(['true', '1', 'yes', 'on', 'TRUE'])('se habilita con una afirmación explícita (%s)', (valor) => {
    expect(readTelemetryConfig({ OTEL_ENABLED: valor }).enabled).toBe(true);
  });

  it.each(['false', '0', 'no', 'quizá', ' '])('sigue apagada con %p', (valor) => {
    expect(readTelemetryConfig({ OTEL_ENABLED: valor }).enabled).toBe(false);
  });

  it('usa el nombre por proceso cuando no hay OTEL_SERVICE_NAME', () => {
    expect(readTelemetryConfig(vacio, 'atlas-worker').serviceName).toBe('atlas-worker');
  });

  it('OTEL_SERVICE_NAME manda sobre el nombre del proceso', () => {
    expect(readTelemetryConfig({ OTEL_SERVICE_NAME: 'otro' }, 'atlas-api').serviceName).toBe('otro');
  });

  it('una cadena en blanco no cuenta como valor', () => {
    expect(readTelemetryConfig({ OTEL_SERVICE_NAME: '   ' }, 'atlas-api').serviceName).toBe('atlas-api');
  });

  describe('destino de trazas', () => {
    it('acepta la variable estándar con la ruta completa', () => {
      const config = readTelemetryConfig({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://jaeger:4318/v1/traces' });
      expect(config.tracesEndpoint).toBe('http://jaeger:4318/v1/traces');
    });

    it('acepta la variable base que ya usaban los despliegues y le añade la ruta de señal', () => {
      expect(readTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger:4318' }).tracesEndpoint).toBe(
        'http://jaeger:4318/v1/traces',
      );
    });

    it('no duplica la barra final', () => {
      expect(readTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger:4318//' }).tracesEndpoint).toBe(
        'http://jaeger:4318/v1/traces',
      );
    });

    it('la estándar gana sobre la base', () => {
      const config = readTelemetryConfig({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://a/v1/traces',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://b',
      });
      expect(config.tracesEndpoint).toBe('http://a/v1/traces');
    });

    it('sin ninguna de las dos deja actuar al destino por defecto del exportador', () => {
      expect(readTelemetryConfig(vacio).tracesEndpoint).toBeUndefined();
    });
  });

  describe('muestreo', () => {
    it('lee la proporción declarada', () => {
      expect(readTelemetryConfig({ OTEL_TRACES_SAMPLER_ARG: '0.15' }).samplerRatio).toBeCloseTo(0.15);
    });

    it.each([
      ['2', 1],
      ['-1', 0],
    ])('acota %s a %d', (valor, esperado) => {
      expect(readTelemetryConfig({ OTEL_TRACES_SAMPLER_ARG: valor }).samplerRatio).toBe(esperado);
    });

    it('un valor ilegible cae a 1: perder trazas en silencio por una errata es peor que exportar de más', () => {
      expect(readTelemetryConfig({ OTEL_TRACES_SAMPLER_ARG: 'mucho' }).samplerRatio).toBe(1);
    });
  });

  describe('tiempo de exportación', () => {
    it('vale 10 s por defecto y se acota a [1000, 120000]', () => {
      expect(readTelemetryConfig(vacio).exportTimeoutMs).toBe(10_000);
      expect(readTelemetryConfig({ OTEL_EXPORT_TIMEOUT_MS: '1' }).exportTimeoutMs).toBe(1_000);
      expect(readTelemetryConfig({ OTEL_EXPORT_TIMEOUT_MS: '999999' }).exportTimeoutMs).toBe(120_000);
      expect(readTelemetryConfig({ OTEL_EXPORT_TIMEOUT_MS: 'ya' }).exportTimeoutMs).toBe(10_000);
    });
  });

  describe('propagadores', () => {
    it('W3C por defecto', () => {
      expect(readTelemetryConfig(vacio).propagators).toEqual(['tracecontext', 'baggage']);
    });

    it('respeta el orden declarado y normaliza espacios y mayúsculas', () => {
      expect(readTelemetryConfig({ OTEL_PROPAGATORS: ' Baggage , TRACECONTEXT ' }).propagators).toEqual(['baggage', 'tracecontext']);
    });

    it('una lista vacía vuelve al valor por defecto en vez de dejar el proceso sin propagación', () => {
      expect(readTelemetryConfig({ OTEL_PROPAGATORS: ' , , ' }).propagators).toEqual(['tracecontext', 'baggage']);
    });
  });

  it('el entorno de despliegue cae a NODE_ENV y luego a development', () => {
    expect(readTelemetryConfig({ OTEL_DEPLOYMENT_ENVIRONMENT: 'staging', NODE_ENV: 'production' }).deploymentEnvironment).toBe('staging');
    expect(readTelemetryConfig({ NODE_ENV: 'production' }).deploymentEnvironment).toBe('production');
    expect(readTelemetryConfig(vacio).deploymentEnvironment).toBe('development');
  });

  it('la versión cae a BUILD_VERSION y el nivel de diagnóstico se normaliza en mayúsculas', () => {
    expect(readTelemetryConfig({ BUILD_VERSION: '9.9.9' }).serviceVersion).toBe('9.9.9');
    expect(readTelemetryConfig({ OTEL_DIAG_LOG_LEVEL: 'debug' }).diagLogLevel).toBe('DEBUG');
  });
});
