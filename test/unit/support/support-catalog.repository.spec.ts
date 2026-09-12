import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { SupportCatalogRepository } from '../../../src/modules/support/support-catalog.repository.js';
import type {
  SupportCannedResponseModel,
  SupportCaseCategoryModel,
  SupportQueueModel,
  SupportSlaPolicyModel,
} from '../../../src/database/models/index.js';

/**
 * Los catálogos versionados con los que se clasifica, se enruta y se promete.
 *
 * Dos reglas de versión, y las dos deciden qué se le prometió a alguien.
 *
 * La categoría vigente es la de MAYOR `catalogVersion`, porque reorganizar la taxonomía publica una
 * versión nueva sin borrar la anterior: los casos ya clasificados siguen apuntando a la suya y los
 * nuevos entran por la vigente. Buscar sin ordenar habría devuelto cualquiera de las dos, sin fallar.
 *
 * La política de SLA es la activa de MAYOR versión para esa prioridad, y se devuelve la versión
 * concreta —no los plazos—: si mañana se publica la 3 con plazos más laxos, el caso de hoy se sigue
 * midiendo con la 2, que es lo que se prometió cuando se abrió.
 *
 * Y `ANY` se añade SIEMPRE a la audiencia pedida: hay motivos que son de cualquiera —queja, fraude,
 * consulta genérica— y negárselos a alguien sería peor que el problema que la audiencia resuelve.
 */
type Doble = { findOne: jest.Mock; findAll: jest.Mock };

function doble(): Doble {
  return { findOne: jest.fn(async () => null), findAll: jest.fn(async () => []) };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; order?: unknown[]; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

describe('SupportCatalogRepository', () => {
  let queues: Doble;
  let categories: Doble;
  let slaPolicies: Doble;
  let cannedResponses: Doble;
  let repo: SupportCatalogRepository;
  const tx = {} as never;

  beforeEach(() => {
    queues = doble();
    categories = doble();
    slaPolicies = doble();
    cannedResponses = doble();
    repo = new SupportCatalogRepository(
      queues as unknown as typeof SupportQueueModel,
      categories as unknown as typeof SupportCaseCategoryModel,
      slaPolicies as unknown as typeof SupportSlaPolicyModel,
      cannedResponses as unknown as typeof SupportCannedResponseModel,
    );
  });

  describe('colas', () => {
    it('por código sólo devuelve las ACTIVAS: una cola retirada no debe recibir casos nuevos', async () => {
      await repo.findQueueByCode('t1', 'AUTH_L1', { transaction: tx });

      expect(ultima(queues.findOne).where).toEqual({ tenantId: 't1', queueCode: 'AUTH_L1', isActive: true, deleted: false });
      expect(ultima(queues.findOne).transaction).toBe(tx);
    });

    it('por id NO exige que esté activa: un caso viejo sigue apuntando a su cola retirada', async () => {
      await repo.findQueueById('t1', '11');

      expect(ultima(queues.findOne).where).toEqual({ tenantId: 't1', id: '11', deleted: false });
    });

    it('el listado va en el orden que decidió quien lo configuró, con el código como desempate', async () => {
      await repo.listQueues('t1');

      expect(ultima(queues.findAll).where).toEqual({ tenantId: 't1', isActive: true, deleted: false });
      expect(ultima(queues.findAll).order).toEqual([
        ['display_order', 'ASC'],
        ['queue_code', 'ASC'],
      ]);
    });

    it('se puede acotar por contexto, y sin él no se filtra', async () => {
      await repo.listQueues('t1', 'PARTNER');
      expect(ultima(queues.findAll).where.contextType).toBe('PARTNER');

      await repo.listQueues('t1');
      expect(ultima(queues.findAll).where).not.toHaveProperty('contextType');
    });

    it('exigir una cola que no existe es 404 con su código dentro', async () => {
      const fallo = await repo.requireQueueByCode('t1', 'NO_EXISTE').catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(NotFoundException);
      expect((fallo as NotFoundException).getResponse()).toMatchObject({ code: 'SUPPORT_QUEUE_NOT_FOUND', queueCode: 'NO_EXISTE' });
    });

    it('exigir una que existe la devuelve tal cual', async () => {
      const cola = { id: 11 } as never;
      queues.findOne.mockResolvedValueOnce(cola);

      await expect(repo.requireQueueByCode('t1', 'AUTH_L1')).resolves.toBe(cola);
    });
  });

  describe('categorías', () => {
    it('por código devuelve la de MAYOR versión de catálogo: la vigente, no cualquiera', async () => {
      await repo.findCategoryByCode('t1', 'AUTH');

      expect(ultima(categories.findOne).where).toEqual({ tenantId: 't1', categoryCode: 'AUTH', isActive: true, deleted: false });
      expect(ultima(categories.findOne).order).toEqual([['catalog_version', 'DESC']]);
    });

    it('por id NO exige que esté activa: un caso ya clasificado sigue apuntando a la suya', async () => {
      await repo.findCategoryById('t1', '22');

      expect(ultima(categories.findOne).where).toEqual({ tenantId: 't1', id: '22', deleted: false });
    });

    it('el árbol filtra por audiencia y añade SIEMPRE `ANY`', async () => {
      await repo.listCategories('t1', ['CONSUMER']);

      expect((ultima(categories.findAll).where.audience as Record<symbol, string[]>)[Op.in]).toEqual(['CONSUMER', 'ANY']);
    });

    it('sin audiencias sigue habiendo motivos de cualquiera', async () => {
      await repo.listCategories('t1', []);

      expect((ultima(categories.findAll).where.audience as Record<symbol, string[]>)[Op.in]).toEqual(['ANY']);
    });

    it('el árbol respeta el orden editorial y sólo trae lo vigente', async () => {
      await repo.listCategories('t1', ['CONSUMER']);

      expect(ultima(categories.findAll).where).toMatchObject({ tenantId: 't1', isActive: true, deleted: false });
      expect(ultima(categories.findAll).order).toEqual([
        ['display_order', 'ASC'],
        ['category_code', 'ASC'],
      ]);
    });
  });

  describe('políticas de SLA', () => {
    it('la que se aplica es la ACTIVA de mayor versión para esa prioridad', async () => {
      await repo.findActiveSlaPolicy('t1', 'STD', 'P1', { transaction: tx });

      expect(ultima(slaPolicies.findOne).where).toEqual({
        tenantId: 't1',
        policyCode: 'STD',
        priority: 'P1',
        status: 'active',
        deleted: false,
      });
      expect(ultima(slaPolicies.findOne).order).toEqual([['version_number', 'DESC']]);
    });

    it('la que ya se prometió se lee por id y sin exigir que siga activa', async () => {
      await repo.findSlaPolicyById('t1', '55');

      expect(ultima(slaPolicies.findOne).where).toEqual({ tenantId: 't1', id: '55', deleted: false });
      expect(ultima(slaPolicies.findOne).where).not.toHaveProperty('status');
    });
  });

  describe('respuestas rápidas', () => {
    it('el agente nunca ve borradores: sólo lo publicado de su audiencia', async () => {
      await repo.listCannedResponses('t1', ['INTERNAL']);

      const condicion = ultima(cannedResponses.findAll).where;
      expect(condicion).toMatchObject({ tenantId: 't1', status: 'published', deleted: false });
      expect((condicion.audience as Record<symbol, string[]>)[Op.in]).toEqual(['INTERNAL']);
    });

    it('aquí NO se añade `ANY`: una respuesta rápida se publica para quien se escribió', async () => {
      await repo.listCannedResponses('t1', ['INTERNAL']);

      expect((ultima(cannedResponses.findAll).where.audience as Record<symbol, string[]>)[Op.in]).not.toContain('ANY');
    });

    it('salen agrupadas por código y con la versión más nueva primero', async () => {
      await repo.listCannedResponses('t1', ['INTERNAL']);

      expect(ultima(cannedResponses.findAll).order).toEqual([
        ['response_code', 'ASC'],
        ['version_number', 'DESC'],
      ]);
    });
  });
});
