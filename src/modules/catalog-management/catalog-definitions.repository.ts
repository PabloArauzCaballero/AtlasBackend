/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CountOptions, FindOptions, Op, WhereOptions } from 'sequelize';
import { Model } from 'sequelize-typescript';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
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

  /**
   * Una página de definiciones sobre el orden fijo eventos → observaciones → atributos → features
   * (por código dentro de cada tipo), que es el orden en que el portal las pinta.
   *
   * Antes eran cuatro `findAll` sin límite: la pantalla bajaba el vocabulario entero en cada tecla.
   * Ahora se cuentan los cuatro tipos con el filtro (esos conteos son también las tarjetas) y sólo se
   * leen las filas que caen en la página, con `LIMIT/OFFSET` en el tipo que corresponda.
   */
  async listDefinitions(query: DefinitionsQueryDto) {
    const sources = this.definitionSources(query);
    const counts = await Promise.all(sources.map((source) => (source.included ? source.count() : Promise.resolve(0))));
    let offset = (query.page - 1) * query.limit;
    let remaining = query.limit;
    const pages = await Promise.all(
      sources.map((source, index) => {
        const count = counts[index] ?? 0;
        if (!source.included || remaining === 0 || offset >= count) {
          offset = Math.max(0, offset - count);
          return Promise.resolve([]);
        }
        const take = Math.min(remaining, count - offset);
        const read = source.page(offset, take);
        remaining -= take;
        offset = 0;
        return read;
      }),
    );
    const [events, observations, attributes, features] = pages as [
      EventDefinitionModel[],
      ObservationDefinitionModel[],
      AttributeDefinitionModel[],
      FeatureDefinitionModel[],
    ];
    const [eventCount, observationCount, attributeCount, featureCount] = counts as [number, number, number, number];
    return {
      observations,
      events,
      attributes,
      features,
      counts: { events: eventCount, observations: observationCount, attributes: attributeCount, features: featureCount },
    };
  }

  private definitionSources(query: DefinitionsQueryDto) {
    const statusWhere = query.status === 'active' ? { isActive: true } : query.status === 'inactive' ? { isActive: false } : {};
    const pattern = query.q ? containsLikePattern(query.q) : null;
    const where = (familyField: string, codeField: string, nameField: string): WhereOptions => ({
      ...statusWhere,
      ...(query.domain ? { [familyField]: query.domain } : {}),
      ...(pattern ? { [Op.or]: [{ [codeField]: { [Op.iLike]: pattern } }, { [nameField]: { [Op.iLike]: pattern } }] } : {}),
    });
    const source = <M extends Model>(
      model: { count(options: CountOptions): Promise<number>; findAll(options: FindOptions): Promise<M[]> },
      type: DefinitionsQueryDto['type'],
      fields: [family: string, code: string, name: string],
    ) => {
      const filter = where(...fields);
      return {
        included: query.type === 'all' || query.type === type,
        count: () => model.count({ where: filter } as CountOptions),
        page: (offset: number, limit: number) =>
          model.findAll({ where: filter, order: [[fields[1], 'ASC']], offset, limit } as FindOptions),
      };
    };
    return [
      source(this.eventDefinitionModel, 'event', ['eventFamily', 'eventCode', 'eventName']),
      source(this.observationDefinitionModel, 'observation', ['sourceGroup', 'observationCode', 'observationName']),
      source(this.attributeDefinitionModel, 'attribute', ['sourceType', 'attributeCode', 'attributeName']),
      source(this.featureDefinitionModel, 'feature', ['featureFamily', 'featureCode', 'featureName']),
    ];
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
