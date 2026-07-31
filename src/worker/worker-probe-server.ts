/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite retirar instancias enfermas antes de afectar a clientes u operadores.
 * @system expone liveness, readiness y métricas del proceso worker sin montar la API de negocio.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';
import type Redis from 'ioredis';
import type { MetricsService } from '../common/observability/metrics.service.js';
import type { GracefulShutdownService } from '../common/lifecycle/graceful-shutdown.service.js';
import { buildInfo } from '../config/build-info.js';

const REDIS_PING_TIMEOUT_MS = 2000;

export type WorkerProbeDependencies = {
  sequelize: Sequelize;
  redis: Redis | null;
  metrics: MetricsService | null;
  shutdown: GracefulShutdownService;
};

/**
 * Servidor HTTP mínimo del proceso worker.
 *
 * El worker arranca con `NestFactory.createApplicationContext()`, que instancia todos los módulos
 * SIN registrar ninguna ruta: aunque alguien alcance su puerto, no hay `/customers` ni `/auth` que
 * llamar. Pero un contenedor sin sonda no es desplegable —el orquestador no puede saber si está
 * sano— y un proceso sin `/metrics` es invisible para Prometheus justo donde corre el trabajo que
 * más importa vigilar.
 *
 * Por eso se levanta esto y no un `NestFactory.create()` completo: tres rutas escritas a mano son
 * auditables de un vistazo, mientras que "monté la API pero confío en no publicar el puerto" es una
 * decisión que se revierte sola en cuanto alguien edita un manifiesto.
 *
 * Se usa `node:http` directamente en vez de Express porque no hace falta enrutado, ni middlewares,
 * ni parseo de cuerpo: no hay ningún endpoint que reciba datos.
 */
export function createWorkerProbeServer(deps: WorkerProbeDependencies): Server {
  const logger = new Logger('WorkerProbe');

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void handle(request, response, deps).catch((error: unknown) => {
      logger.error(`Fallo atendiendo la sonda: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'error' }));
    });
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, deps: WorkerProbeDependencies): Promise<void> {
  // Sólo el pathname: la sonda no tiene parámetros y así una query no puede alterar el enrutado.
  const path = (request.url ?? '/').split('?')[0]?.replace(/\/+$/, '') || '/';

  if (request.method !== 'GET') {
    return json(response, 405, { status: 'method_not_allowed' });
  }

  switch (path) {
    case '/health/liveness':
      return json(response, 200, { status: 'alive', role: 'worker', timestamp: new Date().toISOString() });

    case '/health':
    case '/health/readiness':
      return readiness(response, deps);

    case '/metrics':
      return metrics(response, deps);

    default:
      return json(response, 404, { status: 'not_found' });
  }
}

/**
 * Mismo contrato que `/api/v1/health/readiness` de la API, y por la misma razón: durante el drenado
 * por SIGTERM debe responder 503 de inmediato, sin depender de que Postgres conteste.
 */
async function readiness(response: ServerResponse, deps: WorkerProbeDependencies): Promise<void> {
  const shuttingDown = deps.shutdown.isShuttingDown();
  const [postgres, redis] = shuttingDown
    ? (['ok', 'not_configured'] as const)
    : await Promise.all([checkPostgres(deps.sequelize), checkRedis(deps.redis)]);

  const ready = !shuttingDown && postgres === 'ok' && redis !== 'unreachable';
  return json(response, ready ? 200 : 503, {
    status: ready ? 'ready' : 'not_ready',
    role: 'worker',
    version: buildInfo.version,
    commit: buildInfo.commit,
    checks: { postgres, redis },
    shuttingDown,
    timestamp: new Date().toISOString(),
  });
}

async function metrics(response: ServerResponse, deps: WorkerProbeDependencies): Promise<void> {
  if (!deps.metrics) {
    // `METRICS_ENABLED=false` deja el servicio sin registrar: se responde 200 vacío en vez de 404
    // para que un scrape configurado no genere alertas de "target caído" por una decisión de config.
    response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    response.end('');
    return;
  }
  const body = await deps.metrics.render();
  response.writeHead(200, { 'Content-Type': deps.metrics.contentType });
  response.end(body);
}

async function checkPostgres(sequelize: Sequelize): Promise<'ok' | 'unreachable'> {
  try {
    await sequelize.authenticate();
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

async function checkRedis(redis: Redis | null): Promise<'ok' | 'unreachable' | 'not_configured'> {
  if (!redis) return 'not_configured';
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('redis ping timeout')), REDIS_PING_TIMEOUT_MS).unref(),
    );
    await Promise.race([redis.ping(), timeout]);
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

function json(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
