import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { SystemJobRunModel, SystemStressProfileModel } from '../../database/models/index.js';
import { QueueStressRunDto, SystemsRunsQueryDto } from './systems-ops.schemas.js';
import { systemsTenantScope } from './systems-tenant-scope.util.js';

function actorId(user: AuthenticatedUser | undefined): string | null {
  return user?.internalUserId ?? user?.platformUserId ?? user?.sub ?? null;
}

function mapSystemJobRun(row: SystemJobRunModel) {
  return {
    jobRunId: String(row.id),
    jobCode: row.jobCode,
    status: row.status,
    startedAt: row.startedAt?.toISOString?.() ?? null,
    completedAt: row.completedAt?.toISOString?.() ?? null,
    inputJson: row.inputJson,
    resultJson: row.resultJson,
    errorMessage: row.errorMessage,
    triggeredByType: row.triggeredByType,
    triggeredById: row.triggeredById,
    createdAt: row.createdAtValue?.toISOString?.() ?? null,
  };
}

@Injectable()
export class SystemsStressRunService {
  constructor(
    @InjectModel(SystemStressProfileModel) private readonly stressProfileModel: typeof SystemStressProfileModel,
    @InjectModel(SystemJobRunModel) private readonly jobRunModel: typeof SystemJobRunModel,
  ) {}

  async queueStressRun(profileId: string, input: QueueStressRunDto, user: AuthenticatedUser) {
    const profile = await this.stressProfileModel.findByPk(profileId);
    if (!profile) throw new NotFoundException('SYSTEM_STRESS_PROFILE_NOT_FOUND');
    this.assertProfileCanBeQueued(profile, input);

    const now = new Date();
    const run = await this.jobRunModel.create({
      tenantId: systemsTenantScope(user),
      jobCode: 'systems_stress_run',
      status: 'queued',
      startedAt: null,
      completedAt: null,
      inputJson: {
        profileId: String(profile.id),
        endpointId: String(profile.endpointId),
        profileCode: profile.code,
        environment: input.environment,
        dryRun: input.dryRun,
        baseUrl: input.baseUrl ?? null,
        targetRps: profile.targetRps,
        durationSeconds: profile.durationSeconds,
        concurrency: profile.concurrency,
        maxErrorRate: profile.maxErrorRate,
        maxP95Ms: profile.maxP95Ms,
        approvalTicket: input.approvalTicket ?? null,
        config: input.config,
        headers: this.sanitizeHeaders(input.headers),
        note: 'Fase 4 solo encola el plan de stress. La ejecución real debe hacerla un worker externo controlado.',
      },
      resultJson: null,
      errorMessage: null,
      triggeredByType: 'user',
      triggeredById: actorId(user),
      createdAtValue: now,
    } as never);
    return { queued: true, run: mapSystemJobRun(run) };
  }

  async listStressRuns(query: SystemsRunsQueryDto, user: AuthenticatedUser) {
    const tenantId = systemsTenantScope(user);
    const where: WhereOptions = {
      jobCode: 'systems_stress_run',
      ...(query.status ? { status: query.status.toLowerCase() } : {}),
      ...(tenantId === null ? {} : { tenantId }),
    } as WhereOptions;
    const result = await this.jobRunModel.findAndCountAll({
      where,
      order: [['createdAtValue', 'DESC']],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { items: result.rows.map(mapSystemJobRun), meta: buildPaginationMeta(query, result.count) };
  }

  private assertProfileCanBeQueued(profile: SystemStressProfileModel, input: QueueStressRunDto): void {
    if (!profile.isEnabled || profile.status !== 'ACTIVE') throw new BadRequestException('SYSTEM_STRESS_PROFILE_NOT_ACTIVE');
    if (!profile.environmentScope.includes(input.environment)) throw new BadRequestException('SYSTEM_STRESS_ENVIRONMENT_NOT_ALLOWED');
    if (input.environment === 'PRODUCTION_READONLY') throw new BadRequestException('STRESS_RUNS_ARE_BLOCKED_IN_PRODUCTION');
    if (!input.dryRun && profile.requiresApproval && !input.approvalTicket) {
      throw new BadRequestException('STRESS_RUN_REQUIRES_APPROVAL_TICKET');
    }
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      sanitized[key] = /authorization|token|cookie|secret|key/i.test(key) ? '[REDACTED]' : value;
    }
    return sanitized;
  }
}
