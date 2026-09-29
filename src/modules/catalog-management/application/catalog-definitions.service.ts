/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { buildPaginationMeta } from '../../../common/utils/pagination/pagination.util.js';
import { definitionDtos } from '../catalog-management.mapper.js';
import { CatalogManagementRepository } from '../catalog-management.repository.js';
import { DefinitionsPackageDto, DefinitionsQueryDto } from '../catalog-management.schemas.js';
import { actorPlatformUserId, assertInternal, auditBase, RequestContext, requireIdempotency } from './catalog-management.shared.js';
import {
  toAttributeDefinitionRow,
  toEventDefinitionRow,
  toFeatureDefinitionRow,
  toObservationDefinitionRow,
} from './catalog-definition-rows.mapper.js';

@Injectable()
export class CatalogDefinitionsService {
  constructor(
    private readonly repository: CatalogManagementRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Las cuatro listas por tipo se conservan (compatibilidad) pero traen sólo las filas de la página;
   * `meta` pagina el conjunto y `summary` cuenta cada tipo con el filtro entero, que es lo que pintan
   * las tarjetas (antes contaban `length` de listas sin límite).
   */
  async listDefinitions(input: { query: DefinitionsQueryDto; currentUser: AuthenticatedUser }) {
    assertInternal(input.currentUser);
    const page = await this.repository.listDefinitions(input.query);
    const total = page.counts.events + page.counts.observations + page.counts.attributes + page.counts.features;
    return {
      ...definitionDtos(page),
      meta: buildPaginationMeta({ page: input.query.page, limit: input.query.limit }, total),
      summary: { total, ...page.counts },
    };
  }

  async upsertDefinitionsPackage(input: { body: DefinitionsPackageDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    assertInternal(input.currentUser);
    requireIdempotency(input.context);
    const now = new Date();
    const at = { createdAtValue: now, updatedAtValue: now };
    const { domain, definitions } = input.body;

    return this.sequelize.transaction(async (transaction) => {
      // La traducción DTO -> fila vive en `catalog-definition-rows.mapper.ts`. Aquí queda lo que es
      // competencia de este servicio: el orden de escritura, la transacción y la auditoría.
      for (const item of definitions.events) {
        await this.repository.upsertEventDefinition(toEventDefinitionRow(item, domain, at), { transaction });
      }
      for (const item of definitions.observations) {
        await this.repository.upsertObservationDefinition(toObservationDefinitionRow(item, domain, at), { transaction });
      }
      for (const item of definitions.attributes) {
        await this.repository.upsertAttributeDefinition(toAttributeDefinitionRow(item, domain, at), { transaction });
      }
      for (const item of definitions.features) {
        await this.repository.upsertFeatureDefinition(toFeatureDefinitionRow(item, domain, at), { transaction });
      }

      const processed = {
        events: definitions.events.length,
        observations: definitions.observations.length,
        attributes: definitions.attributes.length,
        features: definitions.features.length,
      };

      await this.repository.createAudit(
        {
          ...auditBase(input.context, input.currentUser),
          actionCode: 'definitions.package.upsert',
          targetType: 'definitions_package',
          targetId: domain,
          payload: processed,
          occurredAt: now,
        },
        { transaction },
      );
      await this.repository.createDataChange(
        {
          tenantId: input.context.tenantId,
          tableName: 'definitions',
          recordId: domain,
          changeType: 'upsert_package',
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: actorPlatformUserId(input.currentUser),
          reason: 'Paquete de definiciones registrado.',
          newValues: processed,
          happenedAt: now,
        },
        { transaction },
      );
      return {
        domain,
        eventsProcessed: processed.events,
        observationsProcessed: processed.observations,
        attributesProcessed: processed.attributes,
        featuresProcessed: processed.features,
      };
    });
  }
}
