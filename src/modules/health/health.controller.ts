import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';

type HealthStatus = {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  database: 'ok' | 'unreachable';
  uptime: number;
  timestamp: string;
};

@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  @Public()
  @Get()
  async check(): Promise<HealthStatus> {
    let dbStatus: 'ok' | 'unreachable' = 'ok';
    try {
      await this.sequelize.authenticate();
    } catch {
      dbStatus = 'unreachable';
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'atlas-backend',
      version: process.env['npm_package_version'] ?? '0.1.0',
      database: dbStatus,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
