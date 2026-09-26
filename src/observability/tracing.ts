/**
 * @file Arranque y cierre del SDK de OpenTelemetry. Opt-in e inerte mientras no se habilite.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system inicializa trazas y telemetría antes del runtime, fuera del contenedor de NestJS.
 */
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { RedactingSpanProcessor } from './redacting-span-processor.js';
import { readTelemetryConfig } from './telemetry.config.js';
import { buildInstrumentations } from './telemetry.instrumentations.js';
import type { TelemetryConfig } from './telemetry.types.js';

/**
 * Este módulo se arranca ANTES que ningún otro en `main.ts`, `worker.ts` y
 * `messaging-worker.ts`: las instrumentaciones parchean `http`, `express`, `pg`, `ioredis` y
 * `undici` en el instante en que esos módulos se requieren, así que arrancar el SDK después de
 * que Nest los haya cargado produce CERO spans y ningún error que lo explique.
 *
 * Lee `process.env` y no `env.ts` porque corre antes de que exista el contenedor de NestJS. Con
 * `OTEL_ENABLED` apagado el despliegue no paga nada: ni exportador, ni parcheo, ni conexiones.
 *
 * La aplicación NUNCA depende de que el destino de trazas esté disponible: la exportación es
 * asíncrona y un colector inalcanzable sólo pierde spans.
 */
let sdk: NodeSDK | undefined;
let activeConfig: TelemetryConfig | undefined;

/** Módulos cuyo parcheo se pierde si el SDK arranca tarde. Se comprueba, no se supone. */
const INSTRUMENTED_MODULES: readonly string[] = ['/node_modules/express/', '/node_modules/pg/', '/node_modules/ioredis/'];

/**
 * Arranca la telemetría si está habilitada. Idempotente: una segunda llamada no hace nada, lo
 * que importa en las pruebas, donde varios módulos pueden alcanzar este arranque.
 *
 * @param defaultServiceName - Nombre a usar si no hay `OTEL_SERVICE_NAME`. Cada proceso pasa el
 *   suyo: reutilizar el nombre del API en el worker haría inservible el grafo de dependencias.
 * @returns `true` si el SDK quedó activo.
 */
export function startTracing(defaultServiceName?: string): boolean {
  if (sdk) return true;
  const config = readTelemetryConfig(process.env, defaultServiceName);
  if (!config.enabled) return false;

  diag.setLogger(new DiagConsoleLogger(), toDiagLevel(config.diagLogLevel));
  warnIfInstrumentedModulesAlreadyLoaded();
  disableSignalsWeDoNotExport();

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_NAMESPACE]: config.serviceNamespace,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      'deployment.environment.name': config.deploymentEnvironment,
    }),
    // Sin endpoint configurado se usa el destino OTLP por defecto (localhost:4318), que es la
    // convención del colector como sidecar.
    // El saneado va PRIMERO en la lista y el lote después: los procesadores se ejecutan en
    // orden, así que lo que el exportador ve es el span ya limpio. Con `traceExporter` a secas el
    // SDK crearía su propio lote y no habría dónde intercalar esto.
    spanProcessors: [
      new RedactingSpanProcessor(),
      new BatchSpanProcessor(new OTLPTraceExporter({ url: config.tracesEndpoint, timeoutMillis: config.exportTimeoutMs })),
    ],
    // Basado en el padre: si un servicio aguas arriba ya decidió muestrear una traza, se respeta
    // su decisión, porque media traza no sirve para nada. La proporción sólo gobierna las trazas
    // que nacen aquí.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.samplerRatio) }),
    textMapPropagator: buildPropagator(config),
    instrumentations: buildInstrumentations(config),
  });

  sdk.start();
  activeConfig = config;
  return true;
}

/**
 * Apaga las señales que este backend NO exporta.
 *
 * `NodeSDK` no se limita a lo que se le pasa por constructor: cuando `OTEL_METRICS_EXPORTER` o
 * `OTEL_LOGS_EXPORTER` no están declaradas, su valor por defecto es `otlp`, así que arranca
 * ADEMÁS un proveedor de métricas y uno de registros apuntados al mismo destino. Medido el
 * 2026-09-19 durante la corrida de carga: con Jaeger como destino, el lector periódico de
 * métricas fallaba cada minuto con `OTLPExporterError: Not Found` —Jaeger no sirve
 * `/v1/metrics`— y dejaba un error en el log de la aplicación por cada intento.
 *
 * El ruido es lo de menos. Las métricas de las instrumentaciones llevan sus propios atributos
 * (ruta, método, código de estado) y **no pasan por `RedactingSpanProcessor`**, que sólo actúa
 * sobre spans: una señal que nadie pidió saldría del proceso por fuera de la única barrera de
 * saneado que hay. Las métricas de este backend ya las publica `prom-client`, que es donde
 * están declaradas y revisadas.
 *
 * Se declara el valor por defecto en vez de imponerlo: si un operador pone `OTEL_METRICS_EXPORTER`
 * a propósito, su decisión manda.
 */
function disableSignalsWeDoNotExport(): void {
  process.env.OTEL_METRICS_EXPORTER ??= 'none';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';
}

/**
 * Vacía y detiene el exportador. NUNCA lanza: perder spans no puede convertir un apagado limpio
 * en una caída.
 */
export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (error) {
    // Se informa por el canal de diagnóstico de OpenTelemetry, no se silencia: un vaciado que
    // falla siempre es una pérdida de evidencia y debe poder verse.
    diag.error('Fallo al vaciar el exportador de trazas', error);
  } finally {
    sdk = undefined;
    activeConfig = undefined;
  }
}

/** Alias histórico: los tres entrypoints ya lo enganchan a SIGTERM/SIGINT. */
export const shutdownTracing = stopTracing;

/** Configuración con la que arrancó el SDK, o `undefined` si la telemetría está apagada. */
export function activeTelemetryConfig(): TelemetryConfig | undefined {
  return activeConfig;
}

/**
 * Avisa si algún módulo instrumentable ya estaba cargado cuando el SDK arrancó.
 *
 * El fallo que previene es SILENCIOSO: si el arranque deja de ser lo primero —porque alguien
 * mueve el import, o porque el paquete pasa a `"type": "module"` y el motor hoista todas las
 * importaciones por encima de esta llamada— las instrumentaciones no parchean nada y el sistema
 * exporta trazas vacías sin un solo error. Un aviso por el canal de diagnóstico cuesta nada y
 * convierte un misterio de tarde entera en una línea de log.
 */
function warnIfInstrumentedModulesAlreadyLoaded(): void {
  if (typeof require === 'undefined' || typeof require.cache !== 'object') return;
  const loaded = Object.keys(require.cache);
  const late = INSTRUMENTED_MODULES.filter((marker) => loaded.some((path) => path.split('\\').join('/').includes(marker)));
  if (late.length === 0) return;
  diag.warn(
    `El SDK arrancó DESPUÉS de cargar ${late.join(', ')}: esos módulos no quedarán instrumentados. ` +
      'El arranque de telemetría debe ser el primer import del entrypoint.',
  );
}

/**
 * Compone los propagadores declarados.
 *
 * Sólo W3C: `tracecontext` es el estándar y `baggage` lo acompaña. B3 se reconoce para poder
 * avisar, pero no se implementa — no hay ningún consumidor heredado que lo exija y añadirlo
 * sólo engordaría las cabeceras de cada petición saliente.
 */
function buildPropagator(config: TelemetryConfig): CompositePropagator {
  const propagators = [];
  for (const name of config.propagators) {
    if (name === 'tracecontext') propagators.push(new W3CTraceContextPropagator());
    else if (name === 'baggage') propagators.push(new W3CBaggagePropagator());
    else diag.warn(`Propagador no soportado en OTEL_PROPAGATORS, ignorado: ${name}`);
  }
  // Una lista que sólo trajera nombres desconocidos dejaría el proceso sin propagación y
  // rompería la correlación entre servicios en silencio.
  if (propagators.length === 0) {
    propagators.push(new W3CTraceContextPropagator(), new W3CBaggagePropagator());
  }
  return new CompositePropagator({ propagators });
}

function toDiagLevel(level: string): DiagLogLevel {
  const levels: Readonly<Record<string, DiagLogLevel>> = {
    NONE: DiagLogLevel.NONE,
    ERROR: DiagLogLevel.ERROR,
    WARN: DiagLogLevel.WARN,
    INFO: DiagLogLevel.INFO,
    DEBUG: DiagLogLevel.DEBUG,
    VERBOSE: DiagLogLevel.VERBOSE,
    ALL: DiagLogLevel.ALL,
  };
  return levels[level] ?? DiagLogLevel.ERROR;
}
