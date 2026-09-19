/**
 * @file Última barrera en proceso: borra de cada span los atributos que no pueden salir.
 * @business Esta pieza evita que credenciales o datos personales acaben en el almacén de trazas.
 * @system procesador de spans que sanea atributos justo antes de que el lote se exporte.
 */
import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';

/**
 * Por qué un procesador y no un hook por instrumentación.
 *
 * Cada biblioteca instrumentada decide sus propios atributos, y esos nombres cambian al subir de
 * versión: en esta misma puesta en marcha `db.statement` pasó a `db.query.text` sólo por avanzar
 * una minor. Un saneado repartido en cinco hooks deja de cubrir en cuanto uno de esos nombres se
 * mueve, y lo hace EN SILENCIO. Aquí hay un único sitio que se aplica a todo lo que se exporta,
 * venga de donde venga.
 *
 * El riesgo concreto que cierra: las URLs firmadas de MinIO llevan la credencial en la cadena de
 * consulta (`X-Amz-Signature`, `X-Amz-Credential`). Una llamada saliente a un objeto guardado
 * —el carnet de un cliente, por ejemplo— publicaría esa URL entera en `url.full`, y con ella una
 * credencial de descarga válida. Se conserva el destino y la ruta, que es lo que diagnostica.
 */

/** Atributos que se borran enteros: su valor no aporta diagnóstico y sí puede llevar secretos. */
const DELETED_ATTRIBUTES: readonly string[] = [
  // La cadena de consulta de este backend lleva identificadores (`?identifier=`,
  // `?documentNumber=`) y las firmas de los objetos almacenados.
  'url.query',
  // Sólo aparece con `enhancedDatabaseReporting`, que está apagado; se borra por si se enciende.
  'db.statement.parameters',
];

/** Atributos que se conservan sin su cadena de consulta. */
const URL_ATTRIBUTES: readonly string[] = ['url.full', 'http.url'];

export class RedactingSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    // Nada al abrir: los atributos que importan los fija la instrumentación durante la operación.
  }

  /**
   * Se ejecuta ANTES que el procesador por lotes —el orden de la lista manda—, así que el span
   * que se exporta es el ya saneado.
   */
  onEnd(span: ReadableSpan): void {
    const attributes = span.attributes as Record<string, unknown>;
    for (const key of DELETED_ATTRIBUTES) {
      if (key in attributes) delete attributes[key];
    }
    for (const key of URL_ATTRIBUTES) {
      const value = attributes[key];
      if (typeof value === 'string') attributes[key] = stripQuery(value);
    }
  }

  async forceFlush(): Promise<void> {
    // No acumula nada: el saneado es síncrono y por span.
  }

  async shutdown(): Promise<void> {
    // Sin recursos que liberar.
  }
}

/**
 * Quita la cadena de consulta y el fragmento conservando el resto.
 *
 * Trabaja sobre la cadena y no con `new URL`: un valor que no sea una URL válida —una ruta
 * relativa, algo a medio construir— no puede hacer fallar la exportación de un lote entero.
 */
export function stripQuery(url: string): string {
  const cut = Math.min(...['?', '#'].map((mark) => indexOrEnd(url, mark)));
  return url.slice(0, cut);
}

function indexOrEnd(value: string, mark: string): number {
  const index = value.indexOf(mark);
  return index === -1 ? value.length : index;
}
