import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createWorkerProbeServer } from '../../../src/worker/worker-probe-server.js';

/**
 * La sonda del worker es lo único que el orquestador puede consultar sobre un proceso que no expone
 * la API de negocio. Si respondiera 200 durante el drenado, cada despliegue del worker cortaría una
 * tanda de jobs en curso; si expusiera cualquier otra ruta, la decisión de no montar los controllers
 * en este proceso quedaría en nada.
 *
 * Se levanta un servidor real en el puerto 0 (el sistema asigna uno libre) y se le pega con `fetch`:
 * el contrato que importa es el HTTP, no las llamadas internas.
 */
describe('worker-probe-server', () => {
  let server: Server;
  let baseUrl: string;

  const deps = {
    sequelize: { authenticate: jest.fn(async (..._args: unknown[]) => undefined) },
    redis: { ping: jest.fn(async (..._args: unknown[]) => 'PONG') },
    metrics: {
      render: jest.fn(async (..._args: unknown[]) => 'atlas_app_info{role="worker"} 1'),
      contentType: 'text/plain; version=0.0.4',
    },
    shutdown: { isShuttingDown: jest.fn((..._args: unknown[]) => false) },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    deps.shutdown.isShuttingDown.mockReturnValue(false);
    deps.sequelize.authenticate.mockResolvedValue(undefined);
    server = createWorkerProbeServer(deps as never);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('liveness responde 200 sin tocar ninguna dependencia', async () => {
    const response = await fetch(`${baseUrl}/health/liveness`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'alive', role: 'worker' });
    expect(deps.sequelize.authenticate).not.toHaveBeenCalled();
  });

  it('readiness responde 200 con Postgres y Redis sanos', async () => {
    const response = await fetch(`${baseUrl}/health/readiness`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('readiness responde 503 si Postgres no contesta: el orquestador debe reiniciar el worker', async () => {
    deps.sequelize.authenticate.mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await fetch(`${baseUrl}/health/readiness`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'not_ready', checks: { postgres: 'unreachable' } });
  });

  it('durante el drenado responde 503 SIN consultar Postgres: la respuesta debe ser inmediata', async () => {
    deps.shutdown.isShuttingDown.mockReturnValue(true);

    const response = await fetch(`${baseUrl}/health/readiness`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ shuttingDown: true });
    expect(deps.sequelize.authenticate).not.toHaveBeenCalled();
  });

  it('expone /metrics en el formato de Prometheus', async () => {
    const response = await fetch(`${baseUrl}/metrics`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('atlas_app_info');
  });

  it('no expone NINGUNA otra ruta: el worker no monta la API de negocio', async () => {
    for (const path of ['/', '/customers', '/api/v1/customers', '/auth/login']) {
      expect((await fetch(`${baseUrl}${path}`)).status).toBe(404);
    }
  });

  it('rechaza métodos que no sean GET: la sonda no recibe datos de nadie', async () => {
    const response = await fetch(`${baseUrl}/health/liveness`, { method: 'POST' });

    expect(response.status).toBe(405);
  });
});
