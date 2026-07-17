import { describe, expect, it, jest } from '@jest/globals';
import { CatalogDefinitionsRepository } from '../../../src/modules/catalog-management/catalog-definitions.repository.js';

/**
 * `CatalogDefinitionsRepository` se extrajo de la fachada `CatalogManagementRepository` (Fase 2.3)
 * para que el agregado de definiciones toque solo sus 4 tablas. El spec verifica el filtrado por
 * tipo/estado/dominio y el upsert por código, sin pasar por la fachada.
 */
describe('CatalogDefinitionsRepository', () => {
  function buildRepo() {
    const models = {
      observationDefinitionModel: { findAll: jest.fn(async () => []), findOne: jest.fn(), create: jest.fn() },
      eventDefinitionModel: { findAll: jest.fn(async () => []), findOne: jest.fn(), create: jest.fn() },
      attributeDefinitionModel: { findAll: jest.fn(async () => []), findOne: jest.fn(), create: jest.fn() },
      featureDefinitionModel: { findAll: jest.fn(async () => []), findOne: jest.fn(), create: jest.fn() },
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
    it('con type=all consulta las 4 tablas de definición', async () => {
      const { repo, models } = buildRepo();
      await repo.listDefinitions({ type: 'all', status: 'all' } as never);
      expect(models.observationDefinitionModel.findAll).toHaveBeenCalledTimes(1);
      expect(models.eventDefinitionModel.findAll).toHaveBeenCalledTimes(1);
      expect(models.attributeDefinitionModel.findAll).toHaveBeenCalledTimes(1);
      expect(models.featureDefinitionModel.findAll).toHaveBeenCalledTimes(1);
    });

    it('con type=event solo consulta la tabla de eventos', async () => {
      const { repo, models } = buildRepo();
      await repo.listDefinitions({ type: 'event', status: 'all' } as never);
      expect(models.eventDefinitionModel.findAll).toHaveBeenCalledTimes(1);
      expect(models.observationDefinitionModel.findAll).not.toHaveBeenCalled();
      expect(models.featureDefinitionModel.findAll).not.toHaveBeenCalled();
    });

    it('status=active filtra por isActive:true y domain aplica el campo de familia correcto', async () => {
      const { repo, models } = buildRepo();
      await repo.listDefinitions({ type: 'event', status: 'active', domain: 'risk' } as never);
      const where = (models.eventDefinitionModel.findAll as jest.Mock).mock.calls[0][0].where;
      expect(where).toMatchObject({ isActive: true, eventFamily: 'risk' });
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
      const existing = { update: jest.fn(async () => undefined) };
      (models.featureDefinitionModel.findOne as jest.Mock).mockResolvedValue(existing as never);
      const result = await repo.upsertFeatureDefinition({ featureCode: 'feat.x' }, {});
      expect(result).toEqual({ record: existing, created: false });
      expect(models.featureDefinitionModel.create).not.toHaveBeenCalled();
    });
  });
});
