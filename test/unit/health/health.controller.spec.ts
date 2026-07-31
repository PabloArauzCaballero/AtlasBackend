import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { HealthController } from '../../../src/modules/health/health.controller.js';

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 4) + hardening 2026-07-21 (O-A2).
 *
 * `check()` (legacy, consumido por el Admin Portal) nunca lanza si la DB está caída: responde
 * `degraded` con 200. `readiness()` en cambio SÍ debe devolver 503 (ServiceUnavailableException)
 * cuando Postgres no responde, para que el balanceador saque la instancia del pool. Redis no
 * configurado (dev) no invalida readiness; Redis configurado pero caído sí.
 */
describe('HealthController', () => {
  function buildController(opts: { authenticate: () => Promise<void>; redis?: Pick<Redis, 'ping'> | null; shuttingDown?: boolean }) {
    const sequelize = { authenticate: jest.fn(opts.authenticate) };
    const redis = opts.redis === undefined ? null : opts.redis;
    const shutdown = { isShuttingDown: () => opts.shuttingDown ?? false };
    const controller = new HealthController(sequelize as never, redis as never, shutdown as never);
    return { controller, sequelize };
  }

  describe('check (legacy, siempre 200)', () => {
    it('reports "ok" when the database responds', async () => {
      const { controller } = buildController({ authenticate: async () => undefined });
      const result = await controller.check();
      expect(result.status).toBe('ok');
      expect(result.database).toBe('ok');
    });

    it('reports "degraded"/"unreachable" when the database throws — never propagates', async () => {
      const { controller } = buildController({
        authenticate: async () => {
          throw new Error('connection refused');
        },
      });
      const result = await controller.check();
      expect(result.status).toBe('degraded');
      expect(result.database).toBe('unreachable');
    });

    it('always includes service, version, uptime and a valid ISO timestamp', async () => {
      const { controller } = buildController({ authenticate: async () => undefined });
      const result = await controller.check();
      expect(result.service).toBe('atlas-backend');
      expect(typeof result.uptime).toBe('number');
      expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
    });
  });

  describe('liveness', () => {
    it('is trivially alive', () => {
      const { controller } = buildController({ authenticate: async () => undefined });
      expect(controller.liveness().status).toBe('alive');
    });
  });

  describe('readiness', () => {
    it('is ready (200) when Postgres responds and Redis is not configured', async () => {
      const { controller } = buildController({ authenticate: async () => undefined, redis: null });
      const result = await controller.readiness();
      expect(result.status).toBe('ready');
      expect(result.checks).toEqual({ postgres: 'ok', redis: 'not_configured' });
    });

    it('is ready when both Postgres and a configured Redis respond', async () => {
      const redis = { ping: jest.fn(async () => 'PONG') };
      const { controller } = buildController({ authenticate: async () => undefined, redis: redis as never });
      const result = await controller.readiness();
      expect(result.status).toBe('ready');
      expect(result.checks).toEqual({ postgres: 'ok', redis: 'ok' });
    });

    it('throws 503 when Postgres is unreachable', async () => {
      const { controller } = buildController({
        authenticate: async () => {
          throw new Error('connection refused');
        },
      });
      await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('throws 503 when a configured Redis is unreachable', async () => {
      const redis = {
        ping: jest.fn(async () => {
          throw new Error('redis down');
        }),
      };
      const { controller } = buildController({ authenticate: async () => undefined, redis: redis as never });
      await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    /**
     * Hallazgo A-07: durante el apagado la instancia debe pedir salir del balanceador de inmediato,
     * y sin depender de que Postgres conteste — si el drenado tuviera que esperar una comprobación
     * de base, un Postgres lento retrasaría justo el momento en que hay que ser rápido.
     */
    it('responde 503 en cuanto empieza el apagado, sin consultar dependencias', async () => {
      const { controller, sequelize } = buildController({ authenticate: async () => undefined, shuttingDown: true });

      await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(sequelize.authenticate).not.toHaveBeenCalled();
    });

    it('el cuerpo del 503 indica explícitamente que la causa es el apagado', async () => {
      const { controller } = buildController({ authenticate: async () => undefined, shuttingDown: true });

      const error = await controller.readiness().catch((thrown: unknown) => thrown);
      const body = (error as ServiceUnavailableException).getResponse() as { status: string; shuttingDown: boolean };
      expect(body.status).toBe('not_ready');
      expect(body.shuttingDown).toBe(true);
    });

    it('mientras no haya apagado, readiness reporta shuttingDown=false', async () => {
      const { controller } = buildController({ authenticate: async () => undefined, redis: null });

      expect((await controller.readiness()).shuttingDown).toBe(false);
    });
  });

  /** Hallazgo A-05: `/health` debe decir QUÉ build está corriendo, no un literal fijo. */
  describe('identidad del build', () => {
    it('reporta version, commit y builtAt del artefacto', async () => {
      const { controller } = buildController({ authenticate: async () => undefined });

      const result = await controller.check();

      expect(result.version).not.toBe('0.1.0');
      expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(result).toHaveProperty('commit');
      expect(result).toHaveProperty('builtAt');
    });
  });
});
