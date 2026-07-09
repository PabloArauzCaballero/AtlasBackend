import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, WhereOptions } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { SystemEndpointCatalogModel, SystemStressProfileModel } from '../../database/models/index.js';
import { SystemsListQueryDto, SystemsStressProfileQueryDto, UpsertStressProfileDto } from './systems-ops.schemas.js';
import { buildEndpointTextWhere, buildStressProfileWhere } from './systems-repository-where.util.js';

@Injectable()
export class SystemsStressProfileRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemStressProfileModel) private readonly stressProfileModel: typeof SystemStressProfileModel,
  ) {}

  async listStressProfiles(query: SystemsStressProfileQueryDto) {
    const result = await this.stressProfileModel.findAndCountAll({
      where: buildStressProfileWhere(query),
      order: [
        ['status', 'ASC'],
        ['code', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }

  findStressProfileById(profileId: string): Promise<SystemStressProfileModel | null> {
    return this.stressProfileModel.findByPk(profileId);
  }

  async upsertStressProfile(values: UpsertStressProfileDto & { code: string; actorId: string | null }): Promise<SystemStressProfileModel> {
    const now = new Date();
    const [row] = await this.stressProfileModel.upsert({
      endpointId: values.endpointId,
      code: values.code,
      name: values.name,
      targetRps: values.targetRps,
      durationSeconds: values.durationSeconds,
      concurrency: values.concurrency,
      environmentScope: values.environmentScope,
      maxErrorRate: values.maxErrorRate,
      maxP95Ms: values.maxP95Ms,
      isEnabled: values.isEnabled,
      requiresApproval: values.requiresApproval,
      status: values.status,
      notes: values.notes ?? null,
      createdBy: values.actorId,
      updatedBy: values.actorId,
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
    return row;
  }

  async findStressProfilesByEndpointIds(endpointIds: string[]): Promise<SystemStressProfileModel[]> {
    if (endpointIds.length === 0) return [];
    return this.stressProfileModel.findAll({ where: { endpointId: endpointIds } } as FindOptions);
  }

  async listStressRequiredEndpoints(query: SystemsListQueryDto) {
    const scopedQuery = { ...query, status: query.status ?? 'ACTIVE' };
    const result = await this.endpointModel.findAndCountAll({
      where: { ...buildEndpointTextWhere(scopedQuery), requiresStressTest: true } as WhereOptions,
      order: [
        ['riskLevel', 'DESC'],
        ['module', 'ASC'],
        ['fullPath', 'ASC'],
      ],
      limit: query.limit,
      offset: toOffset(query),
    } as FindAndCountOptions);
    return { rows: result.rows, meta: buildPaginationMeta(query, result.count) };
  }
}
