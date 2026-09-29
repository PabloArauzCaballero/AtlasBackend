import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { Op } from 'sequelize';
import { CatalogDefinitionsRepository } from '../../../src/modules/catalog-management/catalog-definitions.repository.js';

/**
 * `CatalogDefinitionsRepository` se extrajo de la fachada `CatalogManagementRepository` (Fase 2.3)
 * para que el agregado de definiciones toque solo sus 4 tablas. El spec verifica el filtrado por
 * tipo/estado/dominio y el upsert por código, sin pasar por la fachada.
 */
describe('CatalogDefinitionsRepository', () => {
  /** Cada modelo «tiene» `count` filas: `findAll` devuelve tantas como pida `limit` (con su offset). */
  function model(count: number, prefix: string) {
    return {
      count: jest.fn(async (..._args: unknown[]) => count),
      findAll: jest.fn(async (options: unknown) => {
        const { offset = 0, limit = count } = options as { offset?: number; limit?: number };
        return Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, i) => ({ id: `${prefix}${offset + i}` }));
      }),
      findOne: asyncMock(),
      create: asyncMock(),
    };
  }

  function buildRepo(counts: { events?: number; observations?: number; attributes?: number; features?: number } = {}) {
    const models = {
      observationDefinitionModel: model(counts.observations ?? 0, 'o'),
      eventDefinitionModel: model(counts.events ?? 0, 'e'),
      attributeDefinitionModel: model(counts.attributes ?? 0, 'a'),
      featureDefinitionModel: model(counts.features ?? 0, 'f'),
    };
    const repo = new CatalogDefinitionsRepository(
      models.observationDefinitionModel as never,
      models.eventDefinitionModel as never,
      models.attributeDefinitionModel as never,
      models.featureDefinitionModel as never,
    );
    return { repo, models };
  }

  describe('listDefinitions', () => {
    const base = { type: 'all', status: 'all', page: 1, limit: 20 };

    it('con type=all cuenta las 4 tablas y lee sólo las filas que caen en la página', async () => {
      const { repo, models } = buildRepo({ events: 3, observations: 30, attributes: 5, features: 2 });
      const result = await repo.listDefinitions(base as never);
      expect(result.counts).toEqual({ events: 3, observations: 30, attributes: 5, features: 2 });
      expect(result.events.map((row) => (row as { id: string }).id)).toEqual(['e0', 'e1', 'e2']);
      expect(result.observations).toHaveLength(17);
      expect(models.attributeDefinitionModel.findAll).not.toHaveBeenCalled();
      expect(models.featureDefinitionModel.findAll).not.toHaveBeenCalled();
    });

    it('la segunda página sigue en el tipo donde acabó la primera (orden eventos → observaciones → atributos → features)', async () => {
      const { repo, models } = buildRepo({ events: 3, observations: 30, attributes: 5, features: 2 });
      const result = await repo.listDefinitions({ ...base, page: 2 } as never);
      expect(result.events).toEqual([]);
      expect(callArg<CallArgRecord>(models.observationDefinitionModel.findAll, 0, 0)).toMatchObject({ offset: 17, limit: 13 });
      expect(result.observations).toHaveLength(13);
      expect(callArg<CallArgRecord>(models.attributeDefinitionModel.findAll, 0, 0)).toMatchObject({ offset: 0, limit: 5 });
      expect(callArg<CallArgRecord>(models.featureDefinitionModel.findAll, 0, 0)).toMatchObject({ offset: 0, limit: 2 });
    });

    it('con type=event solo consulta la tabla de eventos', async () => {
      const { repo, models } = buildRepo({ events: 1, observations: 4 });
      const result = await repo.listDefinitions({ ...base, type: 'event' } as never);
      expect(models.eventDefinitionModel.findAll).toHaveBeenCalledTimes(1);
      expect(models.observationDefinitionModel.count).not.toHaveBeenCalled();
      expect(models.observationDefinitionModel.findAll).not.toHaveBeenCalled();
      expect(result.counts.observations).toBe(0);
    });

    it('status=active filtra por isActive:true y domain aplica el campo de familia correcto', async () => {
      const { repo, models } = buildRepo({ events: 1 });
      await repo.listDefinitions({ ...base, type: 'event', status: 'active', domain: 'risk' } as never);
      const where = callArg<CallArgRecord>(models.eventDefinitionModel.findAll, 0, 0).where;
      expect(where).toMatchObject({ isActive: true, eventFamily: 'risk' });
    });

    it('q busca «contiene» en código y nombre, con los comodines escapados, y el conteo usa el mismo filtro', async () => {
      const { repo, models } = buildRepo({ features: 1 });
      await repo.listDefinitions({ ...base, type: 'feature', q: '50%_x' } as never);
      const where = callArg<CallArgRecord>(models.featureDefinitionModel.findAll, 0, 0).where as Record<symbol, unknown>;
      expect(where[Op.or]).toEqual([{ featureCode: { [Op.iLike]: '%50\\%\\_x%' } }, { featureName: { [Op.iLike]: '%50\\%\\_x%' } }]);
      expect(callArg<CallArgRecord>(models.featureDefinitionModel.count, 0, 0).where).toBe(where);
    });
  });

  describe('upsert*Definition (vía upsertByCode)', () => {
    it('upsertEventDefinition crea cuando no existe el eventCode', async () => {
      const { repo, models } = buildRepo();
      (models.eventDefinitionModel.findOne as jest.Mock).mockResolvedValue(null as never);
      (models.eventDefinitionModel.create as jest.Mock).mockResolvedValue({ id: 'e1' } as never);
      const result = await repo.upsertEventDefinition({ eventCode: 'evt.new' }, {});
      expect(result).toEqual({ record: { id: 'e1' }, created: true });
    });

    it('upsertFeatureDefinition actualiza cuando ya existe el featureCode', async () => {
      const { repo, models } = buildRepo();
      const existing = { update: jest.fn(async (..._args: unknown[]) => undefined) };
      (models.featureDefinitionModel.findOne as jest.Mock).mockResolvedValue(existing as never);
      const result = await repo.upsertFeatureDefinition({ featureCode: 'feat.x' }, {});
      expect(result).toEqual({ record: existing, created: false });
      expect(models.featureDefinitionModel.create).not.toHaveBeenCalled();
    });
  });
});
