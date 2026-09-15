import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SupportKnowledgeRepository } from '../../../src/modules/support/support-knowledge.repository.js';
import type { KnowledgeArticleModel, KnowledgeArticleVersionModel } from '../../../src/database/models/index.js';

/**
 * La base de conocimiento: lo que se ofrece como respuesta oficial.
 *
 * El buscador es el punto de fuga clásico de este módulo, y por eso el filtro de audiencia va en el
 * `WHERE` y no en la pantalla: basta con que una vista olvide filtrar para que la guía interna —la
 * que dice cómo se decide un crédito y cuándo escalar a fraude— aparezca en la app del cliente.
 * Junto a eso se fija que sólo se ofrezca lo PUBLICADO (un borrador es texto que nadie aprobó, y
 * darlo por respuesta oficial es peor que no tener respuesta), que publicar retire las versiones
 * anteriores del mismo idioma menos la nueva, y que el voto de utilidad se sume con `increment`:
 * dos personas votando a la vez perderían un voto con el patrón leer-sumar-escribir.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock; update: jest.Mock; increment: jest.Mock };

function doble(): Doble {
  return {
    create: jest.fn(async () => ({ id: 'x' })),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => []),
    update: jest.fn(async () => [0]),
    increment: jest.fn(async () => undefined),
  };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; order?: unknown[]; limit?: number; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

describe('SupportKnowledgeRepository', () => {
  let query: jest.Mock;
  let articles: Doble;
  let versions: Doble;
  let repo: SupportKnowledgeRepository;
  const tx = {} as never;

  beforeEach(() => {
    query = jest.fn(async () => []);
    articles = doble();
    versions = doble();
    repo = new SupportKnowledgeRepository(
      { query } as unknown as Sequelize,
      articles as unknown as typeof KnowledgeArticleModel,
      versions as unknown as typeof KnowledgeArticleVersionModel,
    );
  });

  describe('búsqueda', () => {
    it('filtra por audiencia dentro del WHERE: una pantalla que lo olvide no puede filtrar la guía interna', async () => {
      await repo.search({ tenantId: 't1', query: 'tarjeta', audiences: ['CUSTOMER'], limit: 5 });

      const [sql, opciones] = query.mock.calls.at(-1) as [string, { replacements: Record<string, unknown> }];
      expect(sql).toContain('article.audience IN (:audiences)');
      expect(opciones.replacements).toEqual({ tenantId: 't1', query: 'tarjeta', audiences: ['CUSTOMER'], limit: 5 });
    });

    it('sólo mira la versión publicada y vigente de cada artículo', async () => {
      await repo.search({ tenantId: 't1', query: 'tarjeta', audiences: ['CUSTOMER'], limit: 5 });

      const [sql] = query.mock.calls.at(-1) as [string];
      expect(sql).toContain('article.current_version_id = version._id');
      expect(sql).toContain("article.status = 'PUBLISHED'");
      expect(sql).toContain("version.status = 'PUBLISHED'");
      expect(sql).toContain('article._deleted = FALSE');
    });

    it('el texto buscado viaja parametrizado y ordena por relevancia', async () => {
      await repo.search({ tenantId: 't1', query: "no' OR 1=1", audiences: ['CUSTOMER'], limit: 5 });

      const [sql] = query.mock.calls.at(-1) as [string];
      expect(sql).not.toContain('1=1');
      expect(sql).toContain('ORDER BY rank DESC');
    });

    it('normaliza los identificadores a texto y la relevancia a número', async () => {
      query.mockResolvedValueOnce([
        {
          article_id: 7,
          article_key: 'auth.codigo',
          version_id: 12,
          title: 'No llega el código',
          question: null,
          short_answer: null,
          audience: 'CUSTOMER',
          is_faq: true,
          rank: '0.83',
        },
      ] as never);

      const resultados = await repo.search({ tenantId: 't1', query: 'codigo', audiences: ['CUSTOMER'], limit: 5 });

      expect(resultados[0]).toEqual({
        articleId: '7',
        articleKey: 'auth.codigo',
        versionId: '12',
        title: 'No llega el código',
        question: null,
        shortAnswer: null,
        audience: 'CUSTOMER',
        isFaq: true,
        rank: 0.83,
      });
    });
  });

  describe('FAQ destacadas', () => {
    it('sólo lo publicado, marcado como FAQ y de la audiencia de quien mira', async () => {
      await repo.listFeaturedFaq('t1', ['CUSTOMER', 'PARTNER']);

      const condicion = ultima(articles.findAll).where;
      expect(condicion).toMatchObject({ tenantId: 't1', deleted: false, status: 'PUBLISHED', isFaq: true });
      expect((condicion.audience as Record<symbol, string[]>)[Op.in]).toEqual(['CUSTOMER', 'PARTNER']);
    });

    it('lo destacado va primero y luego el orden editorial, con tope por defecto', async () => {
      await repo.listFeaturedFaq('t1', ['CUSTOMER']);

      expect(ultima(articles.findAll).order).toEqual([
        ['is_featured', 'DESC'],
        ['display_order', 'ASC'],
      ]);
      expect(ultima(articles.findAll).limit).toBe(20);
    });
  });

  describe('artículos', () => {
    it('se buscan por clave o por id, siempre con tenant y sin los borrados', async () => {
      await repo.findArticleByKey('t1', 'auth.codigo');
      expect(ultima(articles.findOne).where).toEqual({ tenantId: 't1', articleKey: 'auth.codigo', deleted: false });

      await repo.findArticleById('t1', '7');
      expect(ultima(articles.findOne).where).toEqual({ tenantId: 't1', id: '7', deleted: false });
    });

    it('exigir uno que no existe es 404 con el código del dominio', async () => {
      articles.findOne.mockResolvedValueOnce(null as never);
      await expect(repo.requireArticleById('t1', '7')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('exigir uno que existe lo devuelve tal cual', async () => {
      const articulo = { id: '7' } as never;
      articles.findOne.mockResolvedValueOnce(articulo);
      await expect(repo.requireArticleById('t1', '7')).resolves.toBe(articulo);
    });

    it('crear y actualizar propagan la transacción, y actualizar sella `updated_at`', async () => {
      await repo.createArticle({ tenantId: 't1' } as never, { transaction: tx });
      expect(articles.create).toHaveBeenCalledWith({ tenantId: 't1' }, { transaction: tx });

      await repo.updateArticle('t1', '7', { status: 'PUBLISHED' } as never, { transaction: tx });
      const [values, opciones] = articles.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown; transaction: unknown }];
      expect(values.updatedAtValue).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ tenantId: 't1', id: '7' });
      expect(opciones.transaction).toBe(tx);
    });
  });

  describe('versiones', () => {
    it('la versión publicada de un idioma es la de mayor número', async () => {
      await repo.findPublishedVersion('7', 'es-BO');

      expect(ultima(versions.findOne).where).toEqual({ articleId: '7', locale: 'es-BO', status: 'PUBLISHED' });
      expect(ultima(versions.findOne).order).toEqual([['version_number', 'DESC']]);
    });

    it('leer una versión por id exige el tenant', async () => {
      await repo.findVersionById('t1', '12');
      expect(ultima(versions.findOne).where).toEqual({ tenantId: 't1', id: '12' });
    });

    it('la primera versión de un idioma es la 1, y la siguiente parte de la mayor existente', async () => {
      versions.findOne.mockResolvedValueOnce(null as never);
      await expect(repo.nextVersionNumber('7', 'es-BO')).resolves.toBe(1);

      versions.findOne.mockResolvedValueOnce({ versionNumber: 4 } as never);
      await expect(repo.nextVersionNumber('7', 'es-BO')).resolves.toBe(5);
    });

    it('el número siguiente se cuenta POR IDIOMA: dos traducciones no comparten numeración', async () => {
      await repo.nextVersionNumber('7', 'en-US');
      expect(ultima(versions.findOne).where).toEqual({ articleId: '7', locale: 'en-US' });
    });

    it('crear y actualizar una versión propagan la transacción, y actualizar sella `updated_at`', async () => {
      await repo.createVersion({ articleId: '7' } as never, { transaction: tx });
      expect(versions.create).toHaveBeenCalledWith({ articleId: '7' }, { transaction: tx });

      await repo.updateVersion('t1', '12', { status: 'PUBLISHED' } as never, { transaction: tx });
      const [values, opciones] = versions.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values.updatedAtValue).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ tenantId: 't1', id: '12' });
    });

    it('publicar retira las anteriores del MISMO idioma y nunca la recién publicada', async () => {
      await repo.retirePublishedVersions('7', 'es-BO', '12', { transaction: tx });

      const [values, opciones] = versions.update.mock.calls.at(-1) as [
        Record<string, unknown>,
        { where: Record<string | symbol, unknown> },
      ];
      expect(values.status).toBe('RETIRED');
      expect(values.retiredAt).toBeInstanceOf(Date);
      expect(opciones.where).toMatchObject({ articleId: '7', locale: 'es-BO', status: 'PUBLISHED' });
      expect((opciones.where.id as Record<symbol, string>)[Op.ne]).toBe('12');
    });
  });

  describe('voto de utilidad', () => {
    it('suma con incremento atómico y no leyendo-sumando-escribiendo', async () => {
      await repo.registerFeedback('t1', '7', true);

      expect(articles.increment).toHaveBeenCalledWith('helpfulCount', {
        by: 1,
        where: { tenantId: 't1', id: '7', deleted: false },
      });
      expect(articles.findOne).not.toHaveBeenCalled();
    });

    it('el voto negativo va a su propio contador', async () => {
      await repo.registerFeedback('t1', '7', false);

      expect(articles.increment).toHaveBeenCalledWith('notHelpfulCount', expect.objectContaining({ by: 1 }));
    });
  });
});
