/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Responde «qué toca este endpoint»: herramientas requeridas, impacto en datos y campos y contrato de payload.
 * @system lee y upserta las tablas de impacto de endpoints de systems-ops.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import {
  SystemEndpointDataEntityImpactModel,
  SystemEndpointFieldImpactModel,
  SystemEndpointPayloadContractModel,
  SystemEndpointToolRequirementModel,
} from '../../database/models/index.js';

export type UpsertDataImpactInput = {
  endpointId: string;
  dataEntityId: string;
  operationType: string;
  impactLevel: string;
  isPrimaryEntity?: boolean;
  affectsCustomerState?: boolean;
  affectsFinancialState?: boolean;
  affectsRiskState?: boolean;
  affectsLegalState?: boolean;
  affectsDeviceState?: boolean;
  affectsNotificationState?: boolean;
  requiresStressTest?: boolean;
  notes?: string | null;
  detectedFrom?: string;
  confidenceLevel?: string;
  reviewStatus?: string;
};

@Injectable()
export class SystemEndpointImpactRepository {
  constructor(
    @InjectModel(SystemEndpointToolRequirementModel) private readonly endpointToolModel: typeof SystemEndpointToolRequirementModel,
    @InjectModel(SystemEndpointDataEntityImpactModel) private readonly dataImpactModel: typeof SystemEndpointDataEntityImpactModel,
    @InjectModel(SystemEndpointFieldImpactModel) private readonly fieldImpactModel: typeof SystemEndpointFieldImpactModel,
    @InjectModel(SystemEndpointPayloadContractModel) private readonly payloadContractModel: typeof SystemEndpointPayloadContractModel,
  ) {}

  findToolRequirementsByEndpoint(endpointId: string): Promise<SystemEndpointToolRequirementModel[]> {
    return this.endpointToolModel.findAll({ where: { endpointId }, order: [['id', 'ASC']] } as FindOptions);
  }

  findDataImpactsByEndpoint(endpointId: string): Promise<SystemEndpointDataEntityImpactModel[]> {
    return this.dataImpactModel.findAll({
      where: { endpointId },
      order: [
        ['impactLevel', 'DESC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  findFieldImpactsByEndpoint(endpointId: string): Promise<SystemEndpointFieldImpactModel[]> {
    return this.fieldImpactModel.findAll({ where: { endpointId }, order: [['fieldName', 'ASC']] } as FindOptions);
  }

  findFieldImpactsByDataEntity(dataEntityId: string): Promise<SystemEndpointFieldImpactModel[]> {
    return this.fieldImpactModel.findAll({ where: { dataEntityId }, order: [['fieldName', 'ASC']] } as FindOptions);
  }

  findDataImpactsByEntity(dataEntityId: string): Promise<SystemEndpointDataEntityImpactModel[]> {
    return this.dataImpactModel.findAll({
      where: { dataEntityId },
      order: [
        ['impactLevel', 'DESC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  findPayloadContractsByEndpoint(endpointId: string): Promise<SystemEndpointPayloadContractModel[]> {
    return this.payloadContractModel.findAll({
      where: { endpointId },
      order: [
        ['contractType', 'ASC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  async upsertDataImpact(values: UpsertDataImpactInput): Promise<void> {
    const now = new Date();
    await this.dataImpactModel.upsert({
      endpointId: values.endpointId,
      dataEntityId: values.dataEntityId,
      operationType: values.operationType,
      impactLevel: values.impactLevel,
      isPrimaryEntity: values.isPrimaryEntity ?? false,
      isTransactional: values.operationType !== 'READ',
      rollbackRequired: values.operationType !== 'READ',
      affectsCustomerState: values.affectsCustomerState ?? false,
      affectsFinancialState: values.affectsFinancialState ?? false,
      affectsRiskState: values.affectsRiskState ?? false,
      affectsLegalState: values.affectsLegalState ?? false,
      affectsDeviceState: values.affectsDeviceState ?? false,
      affectsNotificationState: values.affectsNotificationState ?? false,
      requiresAuditLog: true,
      requiresRegressionTest: values.operationType !== 'READ',
      requiresStressTest: values.requiresStressTest ?? false,
      notes: values.notes ?? null,
      detectedFrom: values.detectedFrom ?? 'docs',
      confidenceLevel: values.confidenceLevel ?? 'MEDIUM',
      reviewStatus: values.reviewStatus ?? 'NEEDS_REVIEW',
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
  }
}
