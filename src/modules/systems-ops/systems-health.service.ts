import { Injectable } from '@nestjs/common';
import { SystemsHealthStatus } from './systems-ops.dtos.js';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import { mapTool } from './systems-ops.mapper.js';

@Injectable()
export class SystemsHealthService {
  constructor(private readonly repository: SystemsCatalogRepository) {}

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
    return result.rows.map((tool) => {
      const dto = mapTool(tool);
      const missingEnvVars = dto.requiredEnvVars.filter((envVar) => !process.env[envVar]);
      return {
        code: dto.code,
        name: dto.name,
        status: dto.status,
        isConfigured: missingEnvVars.length === 0,
        missingEnvVars,
        isCritical: dto.isCritical,
        isWorker: dto.isWorker,
      };
    });
  }
}
