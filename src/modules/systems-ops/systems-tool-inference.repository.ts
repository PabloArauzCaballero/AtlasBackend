import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { SystemEndpointCatalogModel, SystemEndpointToolRequirementModel, SystemToolCatalogModel } from '../../database/models/index.js';

@Injectable()
export class SystemsToolInferenceRepository {
  constructor(
    @InjectModel(SystemEndpointCatalogModel) private readonly endpointModel: typeof SystemEndpointCatalogModel,
    @InjectModel(SystemToolCatalogModel) private readonly toolModel: typeof SystemToolCatalogModel,
    @InjectModel(SystemEndpointToolRequirementModel) private readonly requirementModel: typeof SystemEndpointToolRequirementModel,
  ) {}

  listActiveEndpoints(): Promise<SystemEndpointCatalogModel[]> {
    return this.endpointModel.findAll({ where: { status: 'ACTIVE' }, order: [['code', 'ASC']] } as FindOptions);
  }

  listTools(): Promise<SystemToolCatalogModel[]> {
    return this.toolModel.findAll({ order: [['code', 'ASC']] } as FindOptions);
  }

  async upsertRequirement(
    endpoint: SystemEndpointCatalogModel,
    tool: SystemToolCatalogModel,
    values: {
      usageType: string;
      failureImpact: string;
      isRequired: boolean;
      requiresMock: boolean;
      notes: string;
    },
  ): Promise<SystemEndpointToolRequirementModel> {
    const now = new Date();
    const [row] = await this.requirementModel.upsert({
      endpointId: String(endpoint.id),
      toolId: String(tool.id),
      usageType: values.usageType,
      isRequired: values.isRequired,
      failureImpact: values.failureImpact,
      fallbackStrategy: tool.status === 'PLANNED' ? 'Usar mock/sandbox o mantener flujo en dry-run hasta contrato de proveedor.' : null,
      requiresMock: values.requiresMock || tool.status === 'PLANNED',
      requiresStressTest: endpoint.requiresStressTest && tool.isCritical,
      notes: values.notes,
      detectedFrom: 'source_inference',
      confidenceLevel: endpoint.riskLevel === 'CRITICAL' && tool.isCritical ? 'HIGH' : 'MEDIUM',
      reviewStatus: 'NEEDS_REVIEW',
      createdAtValue: now,
      updatedAtValue: now,
    } as never);
    return row;
  }
}
