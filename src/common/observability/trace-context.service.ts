/**
 * @file Lectura de los identificadores de la traza en curso, para logs y para soporte técnico.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system expone trace_id/span_id del contexto activo sin inventar valores cuando no hay traza.
 */
import { Injectable } from '@nestjs/common';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import type { ActiveTraceIds } from '../../observability/telemetry.types.js';

const EMPTY: ActiveTraceIds = { traceId: undefined, spanId: undefined, traceFlags: undefined };

/**
 * Se expone también como función libre porque el logger la usa en CADA línea y no conviene atarlo
 * al contenedor de inyección para algo que es una lectura sin estado.
 *
 * Un contexto inválido —todo ceros— significa «sin traza». Devolverlo como si fuera real haría
 * que los logs mostraran un identificador que no existe en Jaeger, que es PEOR que no mostrar
 * ninguno: manda a soporte a buscar algo que nunca estuvo.
 */
export function readActiveTraceIds(): ActiveTraceIds {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext === undefined || !isSpanContextValid(spanContext)) return EMPTY;
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
}

/** Identificador de traza para entregar a soporte técnico, o `undefined` si no hay traza. */
export function readActiveTraceId(): string | undefined {
  return readActiveTraceIds().traceId;
}

@Injectable()
export class TraceContextService {
  getActiveIds(): ActiveTraceIds {
    return readActiveTraceIds();
  }

  getActiveTraceId(): string | undefined {
    return readActiveTraceIds().traceId;
  }

  getActiveSpanId(): string | undefined {
    return readActiveTraceIds().spanId;
  }
}
