import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import {
  SystemDataEntityCatalogModel,
  SystemDataRelationshipCatalogModel,
  SystemEndpointCatalogModel,
  SystemEndpointDataEntityImpactModel,
} from '../../database/models/index.js';

@Injectable()
export class SystemsDataImpactInferenceRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemDataEntityCatalogModel) private readonly dataEntityModel: typeof SystemDataEntityCatalogModel,
    @InjectModel(SystemEndpointDataEntityImpactModel) private readonly impactModel: typeof SystemEndpointDataEntityImpactModel,
    @InjectModel(SystemDataRelationshipCatalogModel)
    private readonly relationshipModel: typeof SystemDataRelationshipCatalogModel,
  ) {}

  listActiveEndpoints(): Promise<SystemEndpointCatalogModel[]> {
    return this.endpointModel.findAll({ where: { status: 'ACTIVE' }, order: [['code', 'ASC']] } as FindOptions);
  }

  listEntitiesWithModel(): Promise<SystemDataEntityCatalogModel[]> {
    return this.dataEntityModel.findAll({ order: [['tableName', 'ASC']] } as FindOptions);
  }

  listRelationships(): Promise<SystemDataRelationshipCatalogModel[]> {
    return this.relationshipModel.findAll({ order: [['sourceTable', 'ASC']] } as FindOptions);
  }

  async upsertImpact(
    endpoint: SystemEndpointCatalogModel,
    entity: SystemDataEntityCatalogModel,
    values: {
      operationType: 'READ' | 'UPSERT';
      confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
      notes: string;
      detectedFrom?: string;
    },
  ): Promise<SystemEndpointDataEntityImpactModel> {
    const now = new Date();
    const [row] = await this.impactModel.upsert({
      endpointId: String(endpoint.id),
      dataEntityId: String(entity.id),
      operationType: values.operationType,
      impactLevel: entity.isAuditCritical ? 'HIGH' : 'MEDIUM',
      isPrimaryEntity: false,
      isTransactional: values.operationType !== 'READ',
      rollbackRequired: false,
      affectsCustomerState: entity.module === 'customers',
      affectsFinancialState: entity.containsFinancialData,
      affectsRiskState: entity.containsRiskData,
      affectsLegalState: entity.containsLegalData,
      affectsDeviceState: entity.containsDeviceData,
      affectsNotificationState: entity.module === 'notifications',
      requiresAuditLog: entity.isAuditCritical,
      requiresRegressionTest: values.operationType !== 'READ',
      requiresStressTest: entity.isAuditCritical,
      notes: values.notes,
      detectedFrom: values.detectedFrom ?? 'source_inference',
      confidenceLevel: values.confidenceLevel,
      reviewStatus: 'NEEDS_REVIEW',
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
    return row;
  }
}
