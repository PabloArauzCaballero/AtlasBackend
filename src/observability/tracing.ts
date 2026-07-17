import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ObservabilityConfig, readObservabilityConfig } from '../common/observability/observability.config.js';

/**
 * Bootstrap de OpenTelemetry (Fase 3.4 del plan 10/10). Trazas distribuidas con auto-instrumentación
 * de HTTP/Express/PostgreSQL, propagando el contexto de trace estándar (W3C `traceparent`, con el
 * que el `x-correlation-id` existente convive). Exporta por OTLP/HTTP a un collector.
 *
 * OPT-IN y seguro por defecto: si `OTEL_ENABLED` no está en `true`, `startTracing()` es un no-op y no
 * carga ningún instrumentador — cero impacto en dev/test y en cualquier entorno que no lo active.
 * Debe arrancarse lo ANTES posible (ver `tracing-bootstrap.ts`, importado primero en `main.ts`) para
 * que la auto-instrumentación pueda envolver los módulos antes de que se usen.
 */
let activeSdk: NodeSDK | undefined;

/** Construye el exportador OTLP. Si no hay endpoint explícito, el SDK usa su default (localhost:4318). */
function buildTraceExporter(config: ObservabilityConfig): OTLPTraceExporter {
  if (!config.otlpEndpoint) return new OTLPTraceExporter();
  return new OTLPTraceExporter({ url: `${config.otlpEndpoint.replace(/\/$/, '')}/v1/traces` });
}

/**
 * Arranca el SDK si `tracingEnabled`. Devuelve `true` si quedó activo. Idempotente: una segunda
 * llamada no vuelve a arrancar.
 */
export function startTracing(config: ObservabilityConfig = readObservabilityConfig()): boolean {
  if (!config.tracingEnabled || activeSdk) return false;

  activeSdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: config.serviceName }),
    traceExporter: buildTraceExporter(config),
    // `instrumentation-fs` se apaga: instrumentar cada lectura de disco genera ruido de spans sin
    // valor para una API. HTTP/Express/PG (los que importan para una traza end-to-end) siguen activos.
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });
  activeSdk.start();
  return true;
}

/** Cierra el SDK (flush de spans pendientes). Seguro de llamar aunque no se haya arrancado. */
export async function shutdownTracing(): Promise<void> {
  if (!activeSdk) return;
  await activeSdk.shutdown();
  activeSdk = undefined;
}
