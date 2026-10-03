import { describe, expect, it, jest } from '@jest/globals';
import { SupportKnowledgeService } from '../../../src/modules/support/application/support-knowledge.service.js';
import type { SupportActor } from '../../../src/modules/support/application/support-actor.service.js';

/**
 * Las preguntas frecuentes que se muestran SIN buscar nada.
 *
 * La ayuda de la app salía vacía: los artículos sembrados nunca tuvieron `current_version_id` y la FAQ
 * descartaba todo artículo sin ese enlace. La siembra fundamental no actualiza filas que ya existen,
 * así que no bastaba con arreglar la semilla.
 */
const CLIENTE = { actorType: 'CUSTOMER', actorId: '42', customerId: '42', agentProfileId: null } as SupportActor;

function version(id: number, articleId: number, title: string) {
  return {
    id,
    articleId,
    versionNumber: 1,
    locale: 'es-BO',
    status: 'PUBLISHED',
    title,
    question: `¿${title}?`,
    shortAnswer: 'corto',
    bodyMarkdown: 'cuerpo',
    escalateWhen: null,
    publishedAt: null,
    tagsJson: [],
  };
}

function armar(articulos: Array<{ id: number; articleKey: string; currentVersionId: number | null }>) {
  const knowledge = {
    listFeaturedFaq: jest.fn(async () => articulos),
    findVersionById: jest.fn(async (_t: string, id: string) => version(Number(id), 1, 'enlazada')),
    findPublishedVersion: jest.fn(async (articleId: string, _locale: string): Promise<ReturnType<typeof version> | null> =>
      version(900 + Number(articleId), Number(articleId), `última del ${articleId}`),
    ),
  };
  const actors = { knowledgeAudiences: jest.fn(() => ['PUBLIC_CONSUMER']) };
  const service = new SupportKnowledgeService({} as never, knowledge as never, {} as never, actors as never, {} as never);
  return { service, knowledge };
}

describe('SupportKnowledgeService.featuredFaq', () => {
  it('un artículo sin enlace NO se descarta: se usa su última versión publicada', async () => {
    const { service, knowledge } = armar([{ id: 5, articleKey: 'sin-enlace', currentVersionId: null }]);

    const { faq } = await service.featuredFaq({ tenantId: 't1', actor: CLIENTE });

    expect(faq).toHaveLength(1);
    expect(faq[0]).toMatchObject({ title: 'última del 5' });
    expect(knowledge.findPublishedVersion).toHaveBeenCalledWith('5', 'es-BO');
    expect(knowledge.findVersionById).not.toHaveBeenCalled();
  });

  it('con enlace explícito manda el enlace y no se consulta la última', async () => {
    const { service, knowledge } = armar([{ id: 6, articleKey: 'enlazado', currentVersionId: 61 }]);

    const { faq } = await service.featuredFaq({ tenantId: 't1', actor: CLIENTE });

    expect(faq[0]).toMatchObject({ title: 'enlazada' });
    expect(knowledge.findVersionById).toHaveBeenCalledWith('t1', '61');
    expect(knowledge.findPublishedVersion).not.toHaveBeenCalled();
  });

  it('si no hay ninguna versión publicada, ese artículo se omite y los demás salen', async () => {
    const { service, knowledge } = armar([
      { id: 7, articleKey: 'sin-nada', currentVersionId: null },
      { id: 8, articleKey: 'con-version', currentVersionId: null },
    ]);
    knowledge.findPublishedVersion.mockImplementation(async (articleId: string, _locale: string) =>
      articleId === '7' ? null : version(908, 8, 'ok'),
    );

    const { faq } = await service.featuredFaq({ tenantId: 't1', actor: CLIENTE });

    expect(faq).toHaveLength(1);
    expect(faq[0]).toMatchObject({ title: 'ok' });
  });
});
