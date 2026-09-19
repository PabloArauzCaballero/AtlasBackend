/**
 * @file Tipos de la capa de telemetría: configuración efectiva, portador y contexto activo.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system declara los contratos que comparten el arranque del SDK y la capa de trazado de Nest.
 */
import type { Attributes, Span } from '@opentelemetry/api';

/**
 * Portador del contexto de traza entre procesos. Mapa plano de cabeceras W3C
 * (`traceparent`, `tracestate`, `baggage`), que es exactamente lo que produce
 * `propagation.inject` y lo que se persiste junto al trabajo encolado.
 */
export type TraceCarrier = Record<string, string>;

/** Identificadores de la traza activa. Vacíos cuando no hay span en curso; nunca inventados. */
export type ActiveTraceIds = Readonly<{
  traceId: string | undefined;
  spanId: string | undefined;
  traceFlags: number | undefined;
}>;

/** Operación a ejecutar dentro de un span. Recibe el span para añadir eventos o atributos. */
export type SpanOperation<T> = (span: Span) => Promise<T> | T;

/** Atributos admitidos al abrir un span de negocio. Alias explícito por legibilidad. */
export type SpanAttributes = Attributes;

/**
 * Configuración efectiva del SDK, ya resuelta y acotada.
 *
 * Se materializa como objeto en vez de leerse suelta desde `process.env` en cada punto de uso
 * para que exista UN sitio donde comprobar qué se está exportando y a dónde.
 */
export type TelemetryConfig = Readonly<{
  enabled: boolean;
  serviceName: string;
  serviceNamespace: string;
  serviceVersion: string;
  deploymentEnvironment: string;
  /** `undefined` deja actuar al destino OTLP por defecto del exportador. */
  tracesEndpoint: string | undefined;
  exportTimeoutMs: number;
  /** Ya acotado a [0, 1]. */
  samplerRatio: number;
  /** Nombres de propagador normalizados, en el orden declarado. */
  propagators: readonly string[];
  diagLogLevel: string;
}>;
