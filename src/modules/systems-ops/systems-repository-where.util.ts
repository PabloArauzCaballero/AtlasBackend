import { Op, WhereOptions } from 'sequelize';
import {
  SystemsActionLogQueryDto,
  SystemsListQueryDto,
  SystemsReviewQueueDto,
  SystemsStressProfileQueryDto,
} from './systems-ops.schemas.js';

export function buildEndpointTextWhere(query: SystemsListQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.module ? { module: query.module } : {}),
    ...(query.backendService ? { backendService: query.backendService } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
    ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
  };

  if (query.q) {
    where[Op.or as unknown as string] = [
      { code: { [Op.iLike]: `%${query.q}%` } },
      { fullPath: { [Op.iLike]: `%${query.q}%` } },
      { routeName: { [Op.iLike]: `%${query.q}%` } },
      { businessPurpose: { [Op.iLike]: `%${query.q}%` } },
    ];
  }

  return where as WhereOptions;
}

export function buildToolWhere(query: SystemsListQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.status ? { status: query.status } : {}),
  };

  if (query.q) {
    where[Op.or as unknown as string] = [{ code: { [Op.iLike]: `%${query.q}%` } }, { name: { [Op.iLike]: `%${query.q}%` } }];
  }

  return where as WhereOptions;
}

export function buildDataEntityWhere(query: SystemsListQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.module ? { module: query.module } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
  };

  if (query.q) {
    where[Op.or as unknown as string] = [
      { tableName: { [Op.iLike]: `%${query.q}%` } },
      { entityName: { [Op.iLike]: `%${query.q}%` } },
      { modelName: { [Op.iLike]: `%${query.q}%` } },
    ];
  }

  return where as WhereOptions;
}

export function buildActionLogWhere(query: SystemsActionLogQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.endpointId ? { endpointCatalogId: query.endpointId } : {}),
    ...(query.requestId ? { requestId: query.requestId } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    ...(query.method ? { method: query.method } : {}),
    ...(query.statusCode ? { responseStatusCode: query.statusCode } : {}),
    ...(query.actorType ? { actorType: query.actorType } : {}),
    ...(query.module ? { module: query.module } : {}),
    ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
    ...(query.containsPii !== undefined ? { containsPii: query.containsPii } : {}),
  };

  if (query.from || query.to) {
    where.occurredAt = {
      ...(query.from ? { [Op.gte]: new Date(query.from) } : {}),
      ...(query.to ? { [Op.lte]: new Date(query.to) } : {}),
    };
  }

  return where as WhereOptions;
}

export function buildReviewWhere(query: SystemsReviewQueueDto): WhereOptions {
  return {
    ...(query.module ? { module: query.module } : {}),
    reviewStatus: query.reviewStatus,
  } as WhereOptions;
}

export function buildStressProfileWhere(query: SystemsStressProfileQueryDto): WhereOptions {
  const where: Record<string, unknown> = {
    ...(query.endpointId ? { endpointId: query.endpointId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.enabled !== undefined ? { isEnabled: query.enabled } : {}),
  };

  if (query.q) {
    where[Op.or as unknown as string] = [
      { code: { [Op.iLike]: `%${query.q}%` } },
      { name: { [Op.iLike]: `%${query.q}%` } },
      { notes: { [Op.iLike]: `%${query.q}%` } },
    ];
  }

  return where as WhereOptions;
}
