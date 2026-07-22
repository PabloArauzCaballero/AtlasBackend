import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SkipThrottle } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { Public } from '../../common/decorators/public.decorator.js';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';

type HealthStatus = {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  database: 'ok' | 'unreachable';
  uptime: number;
  timestamp: string;
};

type DependencyState = 'ok' | 'unreachable' | 'not_configured';

type ReadinessStatus = {
  status: 'ready' | 'not_ready';
  checks: { postgres: DependencyState; redis: DependencyState };
  timestamp: string;
};

const REDIS_PING_TIMEOUT_MS = 2000;

@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  @ApiOperation({
    summary: 'Health check del servicio (público, sin auth)',
    description: 'Verifica conectividad a la base de datos y reporta uptime/versión. No requiere autenticación.',
  })
  @ApiResponse({ status: 200, description: 'Servicio saludable o degradado (nunca falla por sí mismo).' })
  @Public()
  @Get()
  async check(): Promise<HealthStatus> {
    const dbStatus = await this.checkPostgres();
    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'atlas-backend',
      version: process.env['npm_package_version'] ?? '0.1.0',
      database: dbStatus,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @ApiOperation({
    summary: 'Liveness probe (¿el proceso está vivo?)',
    description: 'Trivial: si responde, el event loop atiende peticiones. No verifica dependencias.',
  })
  @ApiResponse({ status: 200, description: 'El proceso está vivo.' })
  @Public()
  @Get('liveness')
  @HttpCode(200)
  liveness(): { status: 'alive'; timestamp: string } {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }

  @ApiOperation({
    summary: 'Readiness probe (¿puede atender tráfico?)',
    description:
      'Verifica Postgres (obligatorio) y Redis (si está configurado). Devuelve 503 si Postgres no responde, ' +
      'para que el balanceador/orquestador saque la instancia del pool. Redis no configurado (dev) no falla.',
  })
  @ApiResponse({ status: 200, description: 'Listo para recibir tráfico.' })
  @ApiResponse({ status: 503, description: 'No listo: una dependencia obligatoria no responde.' })
  @Public()
  @Get('readiness')
  async readiness(): Promise<ReadinessStatus> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    const ready = postgres === 'ok' && redis !== 'unreachable';
    const body: ReadinessStatus = {
      status: ready ? 'ready' : 'not_ready',
      checks: { postgres, redis },
      timestamp: new Date().toISOString(),
    };
    if (!ready) {
      // 503 con el detalle en el cuerpo de la excepción, para que el probe lea el estado por rama.
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async checkPostgres(): Promise<'ok' | 'unreachable'> {
    try {
      await this.sequelize.authenticate();
      return 'ok';
    } catch {
      return 'unreachable';
    }
  }

  private async checkRedis(): Promise<DependencyState> {
    // Redis es opcional en dev (sin REDIS_URL el cliente es null); solo cuenta como fallo si está
    // configurado pero no responde. En prod env.ts ya exige REDIS_URL.
    if (!this.redis) {
      return 'not_configured';
    }
    try {
      const ping = this.redis.ping();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('redis ping timeout')), REDIS_PING_TIMEOUT_MS).unref(),
      );
      await Promise.race([ping, timeout]);
      return 'ok';
    } catch {
      return 'unreachable';
    }
  }
}
