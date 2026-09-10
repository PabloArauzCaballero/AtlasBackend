/**
 * @file Utilidad de dominio: los eventos que publica un flujo, como nodos del grafo.
 * @business Esta pieza enseña que un flujo no termina al responder: deja eventos que otro trabajo recoge.
 * @system clasifica cada evento publicado por quién lo consume según el registro de eventos, sin ejecutar nada.
 */
import { env } from '../../config/env.js';
import { listEventDefinitions } from '../events/event-registry.js';
import type { FlowAnalysis } from './system-flows.schemas.js';

/**
 * Quién recoge un evento, dicho con lo que se sabe sin ejecutar nada. Depende de si está registrado y
 * de POR DÓNDE se escribe:
 *
 * - `PROCESS_EVENTS`: registrado; lo toma `process_events` y lo pasa al orquestador.
 * - `RECHAZADO_SIN_REGISTRO`: se publica con `publish` y no está registrado. `EventsService` lanza
 *   `EVENT_NOT_REGISTERED` y el evento NUNCA llega al outbox. La primera versión lo llamaba «outbox de
 *   compatibilidad», que es lo contrario de lo que pasa.
 * - `COMPATIBILIDAD`: se escribe directamente al outbox sin registro (así `customer.lifecycle.*`), y lo
 *   marca procesado `process_outbox` sin que nadie reaccione.
 * - `DEPENDE_DEL_VALOR`: el código se arma en ejecución y hay códigos registrados con ese prefijo.
 * - `DESCONOCIDO`: evento de otro bloque, cuyo registro no está aquí.
 *
 * NO se afirma que avise a nadie: eso se mide con los mensajes que salieron (`pending-work`). Tampoco se
 * comprueba el tipo de agregado permitido, que `EventsService` también exige; hoy todos los publicados
 * lo cumplen.
 */
export type ConsumidorDeEvento = 'PROCESS_EVENTS' | 'RECHAZADO_SIN_REGISTRO' | 'COMPATIBILIDAD' | 'DEPENDE_DEL_VALOR' | 'DESCONOCIDO';

const TEXTO: Record<ConsumidorDeEvento, string> = {
  PROCESS_EVENTS: 'process_events · registrado',
  RECHAZADO_SIN_REGISTRO: 'rechazado al publicar · sin registro',
  COMPATIBILIDAD: 'outbox de compatibilidad · sin registro',
  DEPENDE_DEL_VALOR: 'código armado en ejecución · parte registrada',
  DESCONOCIDO: 'evento de otro bloque',
};

export function consumidorDe(
  systemCode: string,
  evento: { code: string; dynamic: boolean; via?: 'publish' | 'outbox' },
): ConsumidorDeEvento {
  if (systemCode !== 'ATLAS_BACKEND') return 'DESCONOCIDO';
  const registrados = listEventDefinitions().map((definicion) => definicion.code);
  const prefijo = evento.code.replace(/\*$/, '');
  const registrado = evento.dynamic ? registrados.some((code) => code.startsWith(prefijo)) : registrados.includes(evento.code);
  if (registrado) return evento.dynamic ? 'DEPENDE_DEL_VALOR' : 'PROCESS_EVENTS';
  return (evento.via ?? 'publish') === 'publish' ? 'RECHAZADO_SIN_REGISTRO' : 'COMPATIBILIDAD';
}

export function eventosDelFlujo(systemCode: string, analysis: FlowAnalysis) {
  return analysis.events.map((evento) => {
    const consumer = consumidorDe(systemCode, evento);
    return {
      id: `event:${systemCode}:${evento.code}`,
      label: evento.code,
      sublabel: TEXTO[consumer],
      // `at` es fichero:línea: se enseña con la misma regla que el resto de la fuente del grafo.
      meta: { consumer, dynamic: evento.dynamic, via: evento.via, ...(env.FLOWS_EXPOSE_SOURCE ? { at: evento.at } : {}) },
    };
  });
}
