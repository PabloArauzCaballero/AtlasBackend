/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita que el trabajo de fondo compita con la latencia que percibe el cliente.
 * @system resuelve el rol del proceso actual y qué responsabilidades le tocan.
 */
import { env } from './env.js';

export type AppRole = 'api' | 'worker' | 'all';

/**
 * Rol del proceso actual.
 *
 * Un único artefacto (la misma imagen, el mismo `AppModule`) se despliega como API, como worker o
 * como ambos. Quién decide es `APP_ROLE`; estas funciones son el único punto donde se interpreta,
 * para que ningún servicio tenga que volver a razonar sobre el valor crudo.
 *
 * Ver `docs/architecture/background-processing.md`.
 */
export function appRole(): AppRole {
  return env.APP_ROLE;
}

/**
 * ¿Le toca a este proceso ejecutar trabajo de fondo (planificador de jobs, monitor de salud,
 * seeding al arrancar)?
 *
 * `all` responde que sí para conservar el comportamiento histórico: sin configurar `APP_ROLE`, un
 * despliegue de una sola pieza sigue haciendo exactamente lo que hacía.
 */
export function runsBackgroundWork(): boolean {
  return env.APP_ROLE !== 'api';
}

/**
 * ¿Le toca a este proceso atender la API HTTP de negocio?
 *
 * El worker responde que no, y por eso arranca con `createApplicationContext()` (sin rutas) más una
 * sonda mínima: aunque alguien alcance su puerto, no hay ningún endpoint de negocio montado.
 */
export function runsHttpApi(): boolean {
  return env.APP_ROLE !== 'worker';
}

/**
 * ¿Debe ESTE proceso entregar los mensajes de un broadcast dentro de su propio ciclo de vida?
 *
 * En `deferred` la respuesta es no para la API: el request sólo persiste los mensajes en `pending` y
 * los entrega el job `deliver_pending_notifications`. Un proceso que sí ejecuta trabajo de fondo
 * entrega igual —si es el worker el que atiende una llamada interna, no tiene a quién diferirla—,
 * de modo que ninguna combinación de rol y modo deja los mensajes sin dueño.
 */
export function deliversNotificationsInProcess(): boolean {
  return env.NOTIFICATIONS_DELIVERY_MODE === 'inline' || runsBackgroundWork();
}
