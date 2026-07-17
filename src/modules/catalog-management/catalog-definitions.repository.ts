import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import {
  AttributeDefinitionModel,
  EventDefinitionModel,
  FeatureDefinitionModel,
  ObservationDefinitionModel,
} from '../../database/models/index.js';
import { RepositoryOptions, upsertByCode } from './catalog-repository.helpers.js';
import { DefinitionsQueryDto } from './catalog-management.schemas.js';

/**
 * Repositorio del agregado de DEFINICIONES de catalog-management (Fase 2.3 del plan 10/10): el
 * catálogo de definiciones de observaciones, eventos, atributos y features. Toca EXCLUSIVAMENTE sus
 * 4 tablas de definición — sin acceso al resto del esquema de catálogo, riesgo, gobierno o
 * auditoría. `CatalogManagementRepository` delega en este repo para conservar su API pública.
 */
@Injectable()
export class CatalogDefinitionsRepository {
  constructor(
    @InjectModel(ObservationDefinitionModel) private readonly observationDefinitionModel: typeof ObservationDefinitionModel,
    @InjectModel(EventDefinitionModel) private readonly eventDefinitionModel: typeof EventDefinitionModel,
    @InjectModel(AttributeDefinitionModel) private readonly attributeDefinitionModel: typeof AttributeDefinitionModel,
    @InjectModel(FeatureDefinitionModel) private readonly featureDefinitionModel: typeof FeatureDefinitionModel,
  ) {}

  async listDefinitions(query: DefinitionsQueryDto) {
    const statusWhere = query.status === 'active' ? { isActive: true } : query.status === 'inactive' ? { isActive: false } : {};
    const domainFilter = query.domain ? query.domain : undefined;
    const [observations, events, attributes, features] = await Promise.all([
      query.type === 'all' || query.type === 'observation'
        ? this.observationDefinitionModel.findAll({
            where: { ...statusWhere, ...(domainFilter ? { sourceGroup: domainFilter } : {}) },
            order: [['observationCode', 'ASC']],
          } as FindOptions)
        : Promise.resolve([]),
      query.type === 'all' || query.type === 'event'
        ? this.eventDefinitionModel.findAll({
            where: { ...statusWhere, ...(domainFilter ? { eventFamily: domainFilter } : {}) },
            order: [['eventCode', 'ASC']],
          } as FindOptions)
        : Promise.resolve([]),
      query.type === 'all' || query.type === 'attribute'
        ? this.attributeDefinitionModel.findAll({
            where: { ...statusWhere, ...(domainFilter ? { sourceType: domainFilter } : {}) },
            order: [['attributeCode', 'ASC']],
          } as FindOptions)
        : Promise.resolve([]),
      query.type === 'all' || query.type === 'feature'
        ? this.featureDefinitionModel.findAll({
            where: { ...statusWhere, ...(domainFilter ? { featureFamily: domainFilter } : {}) },
            order: [['featureCode', 'ASC']],
          } as FindOptions)
        : Promise.resolve([]),
    ]);
    return { observations, events, attributes, features };
  }

  upsertEventDefinition(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.eventDefinitionModel, 'eventCode', values.eventCode as string, values, options);
  }
  upsertObservationDefinition(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.observationDefinitionModel, 'observationCode', values.observationCode as string, values, options);
  }
  upsertAttributeDefinition(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.attributeDefinitionModel, 'attributeCode', values.attributeCode as string, values, options);
  }
  upsertFeatureDefinition(values: Record<string, unknown>, options: RepositoryOptions) {
    return upsertByCode(this.featureDefinitionModel, 'featureCode', values.featureCode as string, values, options);
  }
}
