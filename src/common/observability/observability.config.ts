/**
 * Configuración de observabilidad (Fase 3.4 del plan 10/10). Se lee directamente de `process.env`,
 * no de `src/config/env.ts`, por dos razones: (1) es config de infraestructura de arranque, y (2) el
 * SDK de OpenTelemetry ya consume variables `OTEL_*` por convención, así que centralizarlas aquí
 * evita duplicar su semántica. Mantener esto fuera de `env.ts` también respeta el gate de tamaño de
 * archivo (env.ts es deuda congelada que no debe crecer).
 */

function readBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return ['true', '1', 'yes', 'y', 'on'].includes(raw.trim().toLowerCase());
}

function readString(name: string, defaultValue: string): string {
  const raw = process.env[name];
  return raw && raw.trim() !== '' ? raw.trim() : defaultValue;
}

export type ObservabilityConfig = {
  /** Expone `GET /metrics` (formato Prometheus) y activa la recolección. Encendido por defecto: barato. */
  metricsEnabled: boolean;
  /** Arranca el SDK de OpenTelemetry (trazas). Apagado por defecto: requiere un collector/OTLP. */
  tracingEnabled: boolean;
  /** Nombre de servicio reportado en trazas/métricas. */
  serviceName: string;
  /** Endpoint OTLP (HTTP) del collector. Si está vacío, el SDK usa su default (localhost:4318). */
  otlpEndpoint: string | undefined;
};

export function readObservabilityConfig(): ObservabilityConfig {
  return {
    metricsEnabled: readBoolean('METRICS_ENABLED', true),
    tracingEnabled: readBoolean('OTEL_ENABLED', false),
    serviceName: readString('OTEL_SERVICE_NAME', 'atlas-backend'),
    otlpEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim() || undefined,
  };
}
