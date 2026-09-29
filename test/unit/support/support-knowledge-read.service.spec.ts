import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { SupportKnowledgeReadService } from '../../../src/modules/support/application/support-knowledge-read.service.js';

const article = {
  id: 7,
  articleKey: 'pagos-qr',
  audience: 'INTERNAL_SUPPORT',
  status: 'IN_REVIEW',
  ownerTeam: 'PAGOS',
  currentVersionId: null,
  isFaq: false,
  isFeatured: false,
  nextReviewAt: null,
  helpfulCount: 0,
  notHelpfulCount: 0,
  updatedAtValue: null,
};
const version = {
  id: 11,
  articleId: 7,
  versionNumber: 2,
  locale: 'es-BO',
  status: 'IN_REVIEW',
  title: 'Cómo verificar un QR',
  question: null,
  shortAnswer: null,
  bodyMarkdown: '# texto',
  tagsJson: ['qr'],
  escalateWhen: null,
  createdByInternalUserId: '3',
  reviewedByInternalUserId: null,
  approvedByInternalUserId: null,
  approvedAt: null,
  publishedAt: null,
  retiredAt: null,
  changeReason: 'nuevo',
  updatedAtValue: null,
};

function build(overrides: { article?: unknown; version?: unknown } = {}) {
  const articles = {
    findAndCountAll: jest.fn(async (_: unknown) => ({ rows: [article], count: 1 })),
    findOne: jest.fn(async (_: unknown) => ('article' in overrides ? overrides.article : article)),
  };
  const versions = {
    findAndCountAll: jest.fn(async (_: unknown) => ({ rows: [version], count: 1 })),
    findAll: jest.fn(async (_: unknown) => [version]),
    findOne: jest.fn(async (_: unknown) => ('version' in overrides ? overrides.version : version)),
  };
  return { service: new SupportKnowledgeReadService(articles as never, versions as never), articles, versions };
}

describe('SupportKnowledgeReadService', () => {
  it('lista artículos de cualquier estado y audiencia, filtrando sólo por tenant y lo pedido', async () => {
    const { service, articles } = build();
    const page = await service.listArticles('1', { status: 'IN_REVIEW', page: 2, pageSize: 10 });
    const options = articles.findAndCountAll.mock.calls[0]![0] as { where: Record<string, unknown>; limit: number; offset: number };
    expect(options.where).toMatchObject({ tenantId: '1', deleted: false, status: 'IN_REVIEW' });
    expect(options.where).not.toHaveProperty('audience');
    expect({ limit: options.limit, offset: options.offset }).toEqual({ limit: 10, offset: 10 });
    expect(page.items[0]).toMatchObject({ articleId: '7', articleKey: 'pagos-qr', status: 'IN_REVIEW' });
  });

  it('la cola de versiones filtra por estado y devuelve quién redactó, para no aprobar lo propio', async () => {
    const { service, versions } = build();
    const page = await service.listVersions('1', { status: 'IN_REVIEW', page: 1, pageSize: 25 });
    expect((versions.findAndCountAll.mock.calls[0]![0] as { where: unknown }).where).toMatchObject({ tenantId: '1', status: 'IN_REVIEW' });
    expect(page.items[0]).toMatchObject({ versionId: '11', createdByInternalUserId: '3' });
  });

  it('la ficha del artículo trae sus versiones y la versión trae el texto completo', async () => {
    const { service } = build();
    expect((await service.getArticle('1', '7')).versions).toHaveLength(1);
    expect(await service.getVersion('1', '11')).toMatchObject({ bodyMarkdown: '# texto', tags: ['qr'] });
  });

  it('un artículo o una versión que no existen son 404', async () => {
    await expect(build({ article: null }).service.getArticle('1', '99')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ version: null }).service.getVersion('1', '99')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la búsqueda mira la clave y el TÍTULO de la versión vigente, escapando comodines, y devuelve ese título', async () => {
    const { service, articles, versions } = build();
    articles.findAndCountAll.mockResolvedValueOnce({ rows: [{ ...article, currentVersionId: '11' as never }], count: 1 });
    const page = await service.listArticles('1', { search: 'qr_50%', page: 1, pageSize: 20 });
    const options = articles.findAndCountAll.mock.calls[0]![0] as {
      where: Record<symbol, unknown[]>;
      replacements: Record<string, string>;
    };
    const [porClave, porTitulo] = options.where[Op.or] as Array<Record<string, Record<symbol, unknown>>>;
    expect(porClave!.articleKey![Op.iLike]).toBe('%qr\\_50\\%%');
    expect((porTitulo!.currentVersionId![Op.in] as { val: string }).val).toMatch(/v\.title ILIKE :patronBusqueda/);
    expect(options.replacements).toEqual({ tenantBusqueda: '1', patronBusqueda: '%qr\\_50\\%%' });
    expect((versions.findAll.mock.calls.at(-1)![0] as { where: unknown }).where).toMatchObject({ tenantId: '1' });
    expect(page.items[0]).toMatchObject({ articleKey: 'pagos-qr', currentTitle: 'Cómo verificar un QR' });
  });
});
