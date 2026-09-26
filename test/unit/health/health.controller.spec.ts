import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';

// El pool de lectura solo se comprueba cuando es una conexión DEDICADA (atlas_app_ro / réplica).
// Ese dato viene de la configuración, así que se controla desde aquí para poder ejercitar las dos
// ramas sin depender de variables de entorno reales.
jest.mock('../../../src/config/database.config.js', () => ({
  isDedicatedReadConnection: jest.fn((..._args: unknown[]) => false),
}));

// ts-jest eleva `jest.mock` por encima de los imports, así que el mock de arriba ya está
// registrado cuando se carga el controlador.
import { HealthController } from '../../../src/modules/health/health.controller.js';
import { isDedicatedReadConnection } from '../../../src/config/database.config.js';
import { env } from '../../../src/config/env.js';

const dedicatedReadMock = isDedicatedReadConnection as jest.MockedFunction<typeof isDedicatedReadConnection>;

/**
 * ATLAS-P12 (plan `PLAN_RED_DE_PRUEBAS_ATLAS_P12.md`, Fase 4) + hardening 2026-07-21 (O-A2).
 *
 * `check()` (legacy, consumido por el Admin Portal) nunca lanza si la DB está caída: responde
 * `degraded` con 200. `readiness()` en cambio SÍ debe devolver 503 (ServiceUnavailableException)
 * cuando Postgres no responde, para que el balanceador saque la instancia del pool. Redis no
 * configurado (dev) no invalida readiness; Redis configurado pero caído sí.
 */
describe('HealthController', () => {
  afterEach(() => {
    dedicatedReadMock.mockReturnValue(false);
  });

  function buildController(opts: {
    authenticate: () => Promise<void>;
    redis?: Pick<Redis, 'ping'> | null;
    shuttingDown?: boolean;
    /** Comportamiento del pool de LECTURA dedicado. Solo se consulta si `dedicatedRead` es true. */
    readAuthenticate?: () => Promise<void>;
    dedicatedRead?: boolean;
  }) {
    const sequelize = { authenticate: jest.fn(opts.authenticate) };
    const redis = opts.redis === undefined ? null : opts.redis;
    const shutdown = { isShuttingDown: () => opts.shuttingDown ?? false };
    const readConnection = { authenticate: jest.fn(opts.readAuthenticate ?? (async () => undefined)) };
    const readQuery = { getConnection: () => readConnection };

    dedicatedReadMock.mockReturnValue(opts.dedicatedRead ?? false);

    const controller = new HealthController(sequelize as never, redis as never, shutdown as never, readQuery as never);
    return { controller, sequelize, readConnection };
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
      expect(result.checks).toEqual({ postgres: 'ok', postgresRead: 'not_configured', redis: 'not_configured' });
    });

    it('is ready when both Postgres and a configured Redis respond', async () => {
      const redis = { ping: jest.fn(async (..._args: unknown[]) => 'PONG') };
      const { controller } = buildController({ authenticate: async () => undefined, redis: redis as never });
      const result = await controller.readiness();
      expect(result.status).toBe('ready');
      expect(result.checks).toEqual({ postgres: 'ok', postgresRead: 'not_configured', redis: 'ok' });
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
        ping: jest.fn(async (..._args: unknown[]) => {
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

  /**
   * Pool de LECTURA (atlas_app_ro / réplica). Se REPORTA pero no decide el readiness: es una
   * dependencia compartida por todas las instancias, así que marcar not_ready sacaría del
   * balanceador a todo el despliegue —incluidas escritura, auth y onboarding, que siguen sanos—
   * convirtiendo una degradación parcial en una caída total.
   */
  describe('readiness — pool de lectura dedicado', () => {
    it('no lo comprueba cuando la conexión de lectura no es dedicada', async () => {
      const { controller, readConnection } = buildController({
        authenticate: async () => undefined,
        dedicatedRead: false,
      });

      const result = await controller.readiness();

      expect(result.checks.postgresRead).toBe('not_configured');
      // Sin conexión dedicada, el token apunta al pool de escritura: sondearlo otra vez solo
      // duplicaría trabajo y haría creer que hay dos dependencias sanas donde hay una.
      expect(readConnection.authenticate).not.toHaveBeenCalled();
    });

    it('reporta "ok" cuando el pool de lectura dedicado responde', async () => {
      const { controller, readConnection } = buildController({
        authenticate: async () => undefined,
        dedicatedRead: true,
      });

      const result = await controller.readiness();

      expect(result.checks.postgresRead).toBe('ok');
      expect(readConnection.authenticate).toHaveBeenCalledTimes(1);
    });

    it('reporta "unreachable" sin invalidar el readiness cuando la réplica está caída', async () => {
      const { controller } = buildController({
        authenticate: async () => undefined,
        redis: null,
        dedicatedRead: true,
        readAuthenticate: async () => {
          throw new Error('replica down');
        },
      });

      const result = await controller.readiness();

      expect(result.checks.postgresRead).toBe('unreachable');
      expect(result.status).toBe('ready');
    });

    it('sigue devolviendo 503 si Postgres cae, aunque el pool de lectura responda', async () => {
      const { controller } = buildController({
        authenticate: async () => {
          throw new Error('primary down');
        },
        dedicatedRead: true,
      });

      await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('durante el apagado no sondea el pool de lectura', async () => {
      const { controller, readConnection } = buildController({
        authenticate: async () => undefined,
        dedicatedRead: true,
        shuttingDown: true,
      });

      await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(readConnection.authenticate).not.toHaveBeenCalled();
    });
  });

  /**
   * Un probe debe responder rápido y mal antes que lento y bien.
   *
   * El escenario que lo justifica es el pool agotado: `authenticate()` se queda esperando una
   * conexión hasta `DB_POOL_ACQUIRE_MS` (30 s por defecto). Como el orquestador vuelve a sondear
   * cada pocos segundos, los sondeos se acumulan en la misma cola que el tráfico real y el probe
   * pasa de detectar la saturación a alimentarla.
   */
  describe('techo de tiempo del sondeo', () => {
    it('no espera indefinidamente a Postgres: lo reporta unreachable y responde 503', async () => {
      const mutableEnv = env as unknown as Record<string, unknown>;
      const original = mutableEnv.HEALTH_DB_PING_TIMEOUT_MS;
      mutableEnv.HEALTH_DB_PING_TIMEOUT_MS = 20;
      // Postgres que nunca contesta: es el pool agotado, no una base caída (esa rechaza rápido).
      const { controller } = buildController({ authenticate: () => new Promise<void>(() => {}) });

      try {
        const error = await controller.readiness().catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
          status: 'not_ready',
          checks: expect.objectContaining({ postgres: 'unreachable' }),
        });
      } finally {
        mutableEnv.HEALTH_DB_PING_TIMEOUT_MS = original;
      }
    });

    it('tampoco espera indefinidamente al pool de lectura, aunque su estado sea informativo', async () => {
      const { controller } = buildController({
        authenticate: async () => undefined,
        dedicatedRead: true,
        readAuthenticate: () => new Promise<void>(() => {}),
      });

      // El pool de lectura no decide el readiness (una réplica caída no debe sacar del balanceador a
      // todo el despliegue), pero si su sondeo colgara, el probe entero dejaría de responder.
      const result = await controller.readiness();

      expect(result.status).toBe('ready');
      expect(result.checks.postgresRead).toBe('unreachable');
    }, 10_000);
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
