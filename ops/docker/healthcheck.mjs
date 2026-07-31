/**
 * Sonda de salud del contenedor, consciente del rol del proceso.
 *
 * La misma imagen se despliega como API (`APP_ROLE=api`/`all`) y como worker (`APP_ROLE=worker`), y
 * cada rol expone su readiness en un puerto y una ruta distintos:
 *
 *   api / all → http://127.0.0.1:${APP_PORT}/${API_PREFIX}/health/readiness
 *   worker    → http://127.0.0.1:${WORKER_PROBE_PORT}/health/readiness
 *
 * Se comprueba READINESS y no liveness a propósito: durante el drenado por SIGTERM readiness
 * responde 503, y esa es exactamente la señal que debe sacar la instancia del balanceador.
 *
 * Está escrito en Node y no como `curl` para no instalar un paquete más en la imagen de producción:
 * cada binario extra es superficie de vulnerabilidades que hay que parchear, y el runtime ya tiene
 * un cliente HTTP perfectamente capaz.
 */
import { get } from 'node:http';

const role = process.env.APP_ROLE ?? 'all';
const isWorker = role === 'worker';

const port = isWorker ? (process.env.WORKER_PROBE_PORT ?? '3006') : (process.env.APP_PORT ?? '3005');
const prefix = isWorker ? '' : `/${(process.env.API_PREFIX ?? 'api/v1').replace(/^\/+|\/+$/g, '')}`;
const path = `${prefix}/health/readiness`;

const TIMEOUT_MS = 4000;

const request = get({ host: '127.0.0.1', port, path, timeout: TIMEOUT_MS }, (response) => {
  // El cuerpo se descarta, pero hay que consumirlo: sin esto el socket queda abierto y el proceso
  // no termina hasta el timeout, convirtiendo un chequeo sano en uno lento.
  response.resume();
  process.exit(response.statusCode === 200 ? 0 : 1);
});

request.on('timeout', () => {
  request.destroy();
  process.exit(1);
});

request.on('error', () => process.exit(1));
