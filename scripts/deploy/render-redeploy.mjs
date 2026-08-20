#!/usr/bin/env node
/**
 * Redespliegue en Render con imagen reconstruida, y espera hasta saber si salió bien.
 *
 * ## Por qué no basta con el auto-deploy de Render
 *
 * Render puede redesplegar solo al detectar un push, y para muchos servicios eso alcanza. Aquí no,
 * por dos motivos concretos:
 *
 * 1. **La caché.** El auto-deploy reutiliza capas de Docker. Cuando lo que cambió está fuera del
 *    `COPY` que invalida la capa —una dependencia del sistema, un artefacto que se descarga al
 *    construir— el servicio arranca con una imagen vieja que parece nueva. Aquí se pide
 *    `clearCache`, así que la imagen se reconstruye de verdad.
 * 2. **El silencio.** Disparar y olvidar deja el trabajo en verde aunque el despliegue falle: el
 *    push se ve exitoso, nadie mira Render y el servicio sigue con la versión anterior durante
 *    horas. Este script ESPERA el desenlace y sale con código distinto de cero si no salió bien,
 *    que es lo que convierte el despliegue en algo que se entera de sus propios fallos.
 *
 * ## Uso
 *
 *   RENDER_API_KEY=rnd_xxx RENDER_SERVICE_ID=srv_xxx node scripts/deploy/render-redeploy.mjs
 *
 * Opciones por variable de entorno:
 *   RENDER_COMMIT_ID           commit exacto a desplegar. Sin él, Render toma la punta de la rama.
 *   RENDER_CLEAR_CACHE=false   reutiliza la caché de capas (más rápido, menos garantía).
 *   RENDER_WAIT=false          dispara y no espera. Ver arriba por qué NO es lo recomendable.
 *   RENDER_TIMEOUT_MS          techo de espera; por omisión 20 minutos.
 */

/** Se puede apuntar a otro host para probar el script contra un doble local (ver su spec). */
const API = process.env.RENDER_API_BASE ?? 'https://api.render.com/v1';

const apiKey = process.env.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID;
/*
 * El commit que se despliega, no «lo último que haya».
 *
 * Sin esto, Render construye la punta de la rama en el momento de recibir la llamada. Con dos
 * commits seguidos, el trabajo del primero informaría del despliegue del SEGUNDO: se pondría verde
 * o rojo por un código que no es el suyo, y el historial de Actions dejaría de decir qué versión
 * llegó a estar en línea. Se fija el SHA y cada despliegue responde por su propio commit.
 */
const commitId = process.env.RENDER_COMMIT_ID?.trim() || undefined;
const clearCache = process.env.RENDER_CLEAR_CACHE !== 'false';
const wait = process.env.RENDER_WAIT !== 'false';
const timeoutMs = Number(process.env.RENDER_TIMEOUT_MS ?? 20 * 60 * 1000);

/** Cada cuánto se pregunta por el estado. Render no notifica: hay que sondear. */
const POLL_INTERVAL_MS = 10_000;

/**
 * Desenlaces de un despliegue de Render.
 *
 * Los de fallo se enumeran uno a uno en vez de dar por bueno «todo lo que no sea `live`»: si Render
 * añade un estado nuevo, prefiero que este script se quede esperando y acabe en timeout —visible—
 * antes que tratarlo como éxito y publicar un despliegue roto.
 */
const SUCCESS = new Set(['live']);
const FAILURE = new Set(['build_failed', 'update_failed', 'canceled', 'deactivated', 'pre_deploy_failed']);

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function renderFetch(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    // El cuerpo entra en el mensaje: Render explica ahí si el servicio no existe o si la clave no
    // tiene permiso sobre él, y sin eso un 404 y un 403 se investigan igual de a ciegas.
    fail(`Render respondió ${response.status} en ${path}: ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!apiKey) fail('Falta RENDER_API_KEY.');
  if (!serviceId) fail('Falta RENDER_SERVICE_ID.');

  const service = await renderFetch(`/services/${serviceId}`);
  console.log(`Servicio: ${service.name} (${service.type}) · rama ${service.branch ?? 'n/d'}`);

  const deploy = await renderFetch(`/services/${serviceId}/deploys`, {
    method: 'POST',
    body: JSON.stringify({
      clearCache: clearCache ? 'clear' : 'do_not_clear',
      ...(commitId ? { commitId } : {}),
    }),
  });
  console.log(
    `Despliegue ${deploy.id} lanzado${clearCache ? ' con caché limpia' : ''}` +
      `${commitId ? ` · commit ${commitId.slice(0, 8)}` : ''}.`,
  );

  if (!wait) {
    console.log('RENDER_WAIT=false: no se espera el desenlace.');
    return;
  }

  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const current = await renderFetch(`/services/${serviceId}/deploys/${deploy.id}`);
    const status = current.status ?? 'unknown';
    if (status !== last) {
      console.log(`  estado: ${status}`);
      last = status;
    }
    if (SUCCESS.has(status)) {
      console.log(`✔ Despliegue ${deploy.id} en línea.`);
      return;
    }
    if (FAILURE.has(status)) {
      fail(`Despliegue ${deploy.id} terminó en ${status}. Revisa los logs del servicio en Render.`);
    }
  }

  /*
   * Agotar el plazo NO se da por bueno. Un despliegue que tarda más de lo previsto puede acabar
   * bien, pero darlo por exitoso aquí haría que el trabajo se pusiera verde sin saberlo — y esa
   * mentira es justo la que este script existe para evitar.
   */
  fail(`El despliegue ${deploy.id} no terminó en ${Math.round(timeoutMs / 60000)} minutos (último estado: ${last}).`);
}

await main();
