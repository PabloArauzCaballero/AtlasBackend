/**
 * @file Propagación explícita del contexto de traza entre procesos a través del outbox.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system inyecta y extrae cabeceras W3C en metadata_json para unir API y worker en una traza.
 */
import { Injectable } from '@nestjs/common';
import { type Attributes, type Context, SpanKind, context as otelContext, propagation } from '@opentelemetry/api';
import { TRACE_CARRIER_KEY } from '../../observability/telemetry.constants.js';
import type { SpanOperation, TraceCarrier } from '../../observability/telemetry.types.js';
import { TracingService } from './tracing.service.js';

/**
 * En este backend el trabajo no viaja por un broker sino como FILA en PostgreSQL: la API escribe
 * en `outbox_events`, hace commit, y segundos o minutos después el relay la reclama en otro
 * proceso. El contexto de OpenTelemetry vive en el almacenamiento asíncrono del proceso y no
 * sobrevive a ese salto, así que la propagación tiene que ser explícita: se inyecta al publicar
 * y se extrae al despachar.
 */
@Injectable()
export class MessagingTraceService {
  constructor(private readonly tracing: TracingService) {}

  /**
   * Serializa el contexto activo en un portador de cabeceras W3C.
   *
   * @returns Mapa con `traceparent` y, cuando existan, `tracestate` y `baggage`. VACÍO si no hay
   *   traza activa, que es un caso normal —telemetría apagada, trabajo interno— y no un error.
   */
  inject(): TraceCarrier {
    const carrier: TraceCarrier = {};
    propagation.inject(otelContext.active(), carrier);
    return carrier;
  }

  /**
   * Reconstruye el contexto remoto a partir del portador que viajó con el trabajo.
   *
   * Tolerante por diseño: una fila escrita antes de que existiera esta propagación no lleva
   * portador, y una manipulada puede llevar cualquier cosa. En ambos casos se devuelve el contexto
   * activo y el consumidor abre una traza raíz, en lugar de rechazar el trabajo. LA
   * COMPATIBILIDAD HACIA ATRÁS ES POR CONSTRUCCIÓN, NO POR UNA RAMA ESPECIAL.
   */
  extract(envelope: unknown): Context {
    const carrier = readCarrier(envelope);
    if (carrier === undefined) return otelContext.active();
    return propagation.extract(otelContext.active(), carrier);
  }

  /**
   * Devuelve la metadata a persistir con el trabajo, con el portador añadido bajo su clave.
   *
   * Conserva la metadata existente y NO toca el objeto recibido: el sobre del evento tiene su
   * propio contrato validado y la trazabilidad no puede alterarlo.
   */
  withCarrier(metadata: Readonly<Record<string, unknown>> | null | undefined): Record<string, unknown> | null {
    const carrier = this.inject();
    const base = metadata ?? {};
    if (Object.keys(carrier).length === 0) return metadata === undefined ? null : { ...base };
    return { ...base, [TRACE_CARRIER_KEY]: carrier };
  }

  /** Abre un span productor sobre la publicación de un trabajo. */
  runAsProducer<T>(name: string, attributes: Attributes, operation: SpanOperation<T>): Promise<T> {
    return this.tracing.runInSpanWith(name, { attributes, kind: SpanKind.PRODUCER }, operation);
  }

  /**
   * Abre un span consumidor enlazado al productor que originó el trabajo.
   *
   * Es `root: false` con contexto padre explícito: si el portador traía contexto, el span continúa
   * la traza del productor; si no, `extract` devolvió el contexto activo —vacío en un worker— y se
   * abre una traza nueva.
   */
  runAsConsumer<T>(name: string, carrier: unknown, attributes: Attributes, operation: SpanOperation<T>): Promise<T> {
    return this.tracing.runInSpanWith(name, { attributes, kind: SpanKind.CONSUMER, parentContext: this.extract(carrier) }, operation);
  }
}

/**
 * Extrae el portador, aceptando el mapa plano de cadenas directamente o envuelto bajo su clave en
 * la metadata. Un valor con otra forma —anidado, numérico, nulo— se descarta sin error: perder la
 * correlación es preferible a perder el trabajo.
 */
function readCarrier(envelope: unknown): TraceCarrier | undefined {
  if (typeof envelope !== 'object' || envelope === null) return undefined;
  const record = envelope as Record<string, unknown>;
  const raw = TRACE_CARRIER_KEY in record ? record[TRACE_CARRIER_KEY] : record;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
