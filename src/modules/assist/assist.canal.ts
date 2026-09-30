/**
 * @file Referencia opaca del actor y superficie con las que se habla al servicio de IA.
 * @business Esta pieza responde dudas de uso de la app y de los portales sin hacer esperar a una persona del equipo.
 * @system decide qué identifica a cada persona en cada portal, para que ningún historial se mezcle.
 */
import { createHash } from 'node:crypto';
import type { AssistAudience, PortalAssistActor } from './assist.service.js';
import type { PortalAssistSurface } from './assist.schemas.js';

/** Por dónde viaja una consulta: la referencia opaca, la superficie (sólo portales) y a quién se le habla. */
export type Canal = { actorRef: string; surface?: PortalAssistSurface; audience: AssistAudience };

/**
 * La referencia opaca con la que el servicio de IA particiona conversaciones. Lleva el inquilino
 * para que el mismo UUID en dos inquilinos jamás comparta hilo; nunca lleva el JWT.
 */
export function canalMovil(tenantId: string, customerId: string): Canal {
  return { actorRef: `${tenantId}:${customerId}`, audience: 'cliente' };
}

/** Lo que el servicio de IA admite en un segmento de la referencia, sin `:` que la partiría. */
const SEGMENTO_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `<superficie>:<tenantId>:<userId>`. La superficie va DELANTE para que la misma persona tenga un
 * hilo por portal: lo que preguntó en Tableros no aparece al abrir el asistente del Motor, y un
 * usuario de comercio nunca comparte hilo con uno interno aunque sus ids coincidan.
 *
 * El servicio exige `[A-Za-z0-9:_-]{1,128}`. Un id con otros caracteres (un `sub` con `@` o `.`)
 * se sustituye por un hash corto y estable: sigue identificando a la misma persona sin viajar tal
 * cual y sin partir la referencia.
 */
export function canalDePortal(actor: PortalAssistActor): Canal {
  const id = SEGMENTO_SEGURO.test(actor.userId) ? actor.userId : createHash('sha256').update(actor.userId).digest('hex').slice(0, 16);
  return { actorRef: `${actor.surface}:${actor.tenantId}:${id}`, surface: actor.surface, audience: actor.audience };
}
