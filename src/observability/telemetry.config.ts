/**
 * @file Lectura y acotado de la configuración de telemetría desde el entorno del proceso.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system resuelve las variables OTEL_* en un objeto validado antes de arrancar el SDK.
 */
import { DEFAULT_SERVICE_NAMESPACE } from './telemetry.constants.js';
import type { TelemetryConfig } from './telemetry.types.js';

/**
 * Lee `process.env` y NO `env.ts` a propósito: esto corre antes de que exista el contenedor de
 * NestJS, porque las instrumentaciones tienen que parchear `http`, `express`, `pg` e `ioredis`
 * en el momento en que se requieren. Las mismas claves están declaradas en
 * `src/config/env.observability.schema.ts`, de modo que quedan validadas y documentadas en vez
 * de ser cadenas mágicas sueltas.
 *
 * El entorno se pasa como argumento para poder probar sin tocar el proceso.
 */
export function readTelemetryConfig(environment: NodeJS.ProcessEnv = process.env, defaultServiceName = 'atlas-backend'): TelemetryConfig {
  return {
    enabled: readBoolean(environment.OTEL_ENABLED),
    serviceName: nonEmpty(environment.OTEL_SERVICE_NAME) ?? defaultServiceName,
    serviceNamespace: nonEmpty(environment.OTEL_SERVICE_NAMESPACE) ?? DEFAULT_SERVICE_NAMESPACE,
    serviceVersion: nonEmpty(environment.OTEL_SERVICE_VERSION) ?? nonEmpty(environment.BUILD_VERSION) ?? '0.3.0',
    deploymentEnvironment: nonEmpty(environment.OTEL_DEPLOYMENT_ENVIRONMENT) ?? nonEmpty(environment.NODE_ENV) ?? 'development',
    tracesEndpoint: readTracesEndpoint(environment),
    exportTimeoutMs: readInteger(environment.OTEL_EXPORT_TIMEOUT_MS, 10_000, 1_000, 120_000),
    samplerRatio: readRatio(environment.OTEL_TRACES_SAMPLER_ARG),
    propagators: readPropagators(environment.OTEL_PROPAGATORS),
    diagLogLevel: (nonEmpty(environment.OTEL_DIAG_LOG_LEVEL) ?? 'ERROR').toUpperCase(),
  };
}

/**
 * Destino de trazas, aceptando las DOS formas que conviven en este repositorio.
 *
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` es la variable estándar y lleva la ruta completa. Los
 * despliegues existentes declaran `OTEL_EXPORTER_OTLP_ENDPOINT`, que es la base del colector
 * SIN la ruta de señal; a esa se le añade `/v1/traces`. Admitir sólo la estándar habría dejado
 * a los despliegues actuales exportando al destino por defecto en silencio.
 */
function readTracesEndpoint(environment: NodeJS.ProcessEnv): string | undefined {
  const explicit = nonEmpty(environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (explicit !== undefined) return explicit;
  const base = nonEmpty(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
  return base === undefined ? undefined : `${base.replace(/\/+$/, '')}/v1/traces`;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** Sólo un `true`/`1`/`yes` explícito habilita la telemetría: el silencio la deja apagada. */
function readBoolean(value: string | undefined): boolean {
  const raw = (value ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Proporción de muestreo, acotada a [0, 1].
 *
 * Un valor ilegible cae a `1`: perder trazas en silencio por una errata de configuración es
 * peor que exportar de más, porque el síntoma —«Jaeger no recibe nada»— no apunta a su causa.
 */
function readRatio(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 0), 1);
}

/**
 * Propagadores declarados. `tracecontext` y `baggage` son el estándar W3C y el valor por
 * defecto; B3 se reconoce para poder avisar, pero no se implementa.
 */
function readPropagators(value: string | undefined): readonly string[] {
  const declared = (value ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return declared.length > 0 ? declared : ['tracecontext', 'baggage'];
}
