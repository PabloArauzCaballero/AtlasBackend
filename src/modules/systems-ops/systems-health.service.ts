import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import Redis from 'ioredis';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../config/env.js';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';
import { SystemsHealthStatus } from './systems-ops.dtos.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { mapTool } from './systems-ops.mapper.js';

@Injectable()
export class SystemsHealthService {
  constructor(
    private readonly repository: SystemsCatalogRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async getToolsHealth(): Promise<SystemsHealthStatus[]> {
    const result = await this.repository.listTools({
      page: 1,
      limit: 100,
      status: undefined,
      module: undefined,
      riskLevel: undefined,
      reviewStatus: undefined,
      q: undefined,
    });
    return Promise.all(
      result.rows.map(async (tool) => {
        const dto = mapTool(tool);
        const parsedEnv = env as unknown as Record<string, unknown>;
        const missingEnvVars = dto.requiredEnvVars.filter((envVar) => {
          const value = parsedEnv[envVar] ?? process.env[envVar];
          return value === undefined || value === null || value === '';
        });
        const live = await this.liveHealth(dto.code, missingEnvVars.length === 0);
        return {
          code: dto.code,
          name: dto.name,
          status: dto.status,
          isConfigured: missingEnvVars.length === 0,
          missingEnvVars,
          isCritical: dto.isCritical,
          isWorker: dto.isWorker,
          ...live,
        };
      }),
    );
  }

  private async liveHealth(
    code: string,
    configured: boolean,
  ): Promise<Pick<SystemsHealthStatus, 'checkType' | 'isHealthy' | 'healthMessage'>> {
    try {
      if (code === 'POSTGRES') {
        await this.sequelize.authenticate();
        return { checkType: 'LIVE', isHealthy: true, healthMessage: 'PostgreSQL respondió correctamente.' };
      }
      if (code === 'REDIS' || code === 'NEST_THROTTLER_REDIS') {
        if (!this.redis) return { checkType: 'LIVE', isHealthy: false, healthMessage: 'Cliente Redis no configurado.' };
        await this.redis.ping();
        return { checkType: 'LIVE', isHealthy: true, healthMessage: 'Redis respondió PONG.' };
      }
      return {
        checkType: 'CONFIGURATION',
        isHealthy: configured ? null : false,
        healthMessage: configured ? 'Configuración requerida presente; sin probe activo.' : 'Faltan variables requeridas.',
      };
    } catch (error) {
      return { checkType: 'LIVE', isHealthy: false, healthMessage: error instanceof Error ? error.message : 'Healthcheck falló.' };
    }
  }
}
