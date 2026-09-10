/**
 * @file Utilidad de dominio: los eventos que publica un flujo, como nodos del grafo.
 * @business Esta pieza enseña que un flujo no termina al responder: deja eventos que otro trabajo recoge.
 * @system clasifica cada evento publicado por quién lo consume según el registro de eventos, sin ejecutar nada.
 */
import { env } from '../../config/env.js';
import { listEventDefinitions } from '../events/event-registry.js';
import type { FlowAnalysis } from './system-flows.schemas.js';

/**
 * Quién recoge un evento, dicho con lo que se sabe sin ejecutar nada.
 *
 * - `PROCESS_EVENTS`: está en el registro, así que lo toma `process_events` y lo pasa al orquestador.
 * - `COMPATIBILIDAD`: no está en el registro, así que lo marca procesado `process_outbox` sin que nadie
 *   reaccione. Es la forma estática de lo que `pending-work` llama `SIN_REGISTRO`.
 * - `DEPENDE_DEL_VALOR`: el código se arma en ejecución y hay códigos registrados con ese prefijo, pero
 *   no se sabe cuál saldrá.
 * - `DESCONOCIDO`: evento de otro bloque, cuyo registro no está aquí.
 *
 * NO se afirma que avise a nadie. Eso depende de las reglas de canales y se mide con los mensajes que
 * de verdad salieron (`pending-work` → `domainEvents`). Aquí sólo se dice quién lo consume.
 */
export type ConsumidorDeEvento = 'PROCESS_EVENTS' | 'COMPATIBILIDAD' | 'DEPENDE_DEL_VALOR' | 'DESCONOCIDO';

const TEXTO: Record<ConsumidorDeEvento, string> = {
  PROCESS_EVENTS: 'process_events · registrado',
  COMPATIBILIDAD: 'outbox de compatibilidad · sin registro',
  DEPENDE_DEL_VALOR: 'código armado en ejecución · parte registrada',
  DESCONOCIDO: 'evento de otro bloque',
};

export function consumidorDe(systemCode: string, evento: { code: string; dynamic: boolean }): ConsumidorDeEvento {
  if (systemCode !== 'ATLAS_BACKEND') return 'DESCONOCIDO';
  const registrados = listEventDefinitions().map((definicion) => definicion.code);
  if (!evento.dynamic) return registrados.includes(evento.code) ? 'PROCESS_EVENTS' : 'COMPATIBILIDAD';
  const prefijo = evento.code.replace(/\*$/, '');
  return registrados.some((code) => code.startsWith(prefijo)) ? 'DEPENDE_DEL_VALOR' : 'COMPATIBILIDAD';
}

export function eventosDelFlujo(systemCode: string, analysis: FlowAnalysis) {
  return analysis.events.map((evento) => {
    const consumer = consumidorDe(systemCode, evento);
    return {
      id: `event:${systemCode}:${evento.code}`,
      label: evento.code,
      sublabel: TEXTO[consumer],
      // `at` es fichero:línea: se enseña con la misma regla que el resto de la fuente del grafo.
      meta: { consumer, dynamic: evento.dynamic, ...(env.FLOWS_EXPOSE_SOURCE ? { at: evento.at } : {}) },
    };
  });
}
