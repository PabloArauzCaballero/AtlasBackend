import { Injectable } from '@nestjs/common';
import { mapActionLog } from './systems-ops.mapper.js';
import { SystemsActionLogQueryDto } from './systems-ops.schemas.js';
import { SystemsActionLogRepository } from './systems-action-log.repository.js';

@Injectable()
export class SystemsActionLogQueryService {
  constructor(private readonly actionLogRepository: SystemsActionLogRepository) {}

  async listActionLogs(query: SystemsActionLogQueryDto) {
    const result = await this.actionLogRepository.listActionLogs(query);
    return { items: result.rows.map(mapActionLog), meta: result.meta };
  }

  async getActionLogsByRequest(requestId: string) {
    const rows = await this.actionLogRepository.findActionLogsByRequest(requestId);
    return { items: rows.map(mapActionLog) };
  }
}
