import { describe, expect, it, jest } from '@jest/globals';
import { SupportKnowledgeService } from '../../../src/modules/support/application/support-knowledge.service.js';

/**
 * El gobierno de la base de conocimiento: quién puede escribir, aprobar y publicar.
 *
 * Un artículo sobre cómo se decide un crédito o qué datos guardamos es una declaración con
 * consecuencias legales. Lo que se fija aquí son los dos controles que hacen que «aprobado»
 * signifique algo —quien escribió no aprueba, y el contenido de dominio lo aprueba el dominio— y el
 * orden del circuito, porque saltárselo publica sin que nadie haya mirado.
 */

function version(over: Record<string, unknown> = {}) {
  return { id: '5', articleId: '9', locale: 'es-BO', versionNumber: 3, status: 'IN_REVIEW', createdByInternalUserId: '100', ...over };
}

function articulo(over: Record<string, unknown> = {}) {
  return { id: '9', articleKey: 'como-pagar', ownerTeam: 'content', ...over };
}

function montar(opciones: { version?: Record<string, unknown>; articulo?: Record<string, unknown> } = {}) {
  const versiones: Array<[string, Record<string, unknown>]> = [];
  const articulos: Array<[string, Record<string, unknown>]> = [];
  const publicados: Array<Record<string, unknown>> = [];
  const retiradas: unknown[][] = [];

  const knowledge = {
    findVersionById: jest.fn(async () => (opciones.version === null ? null : (opciones.version ?? version()))),
    requireArticleById: jest.fn(async () => opciones.articulo ?? articulo()),
    updateVersion: jest.fn(async (_t: string, id: string, v: Record<string, unknown>) => void versiones.push([id, v])),
    updateArticle: jest.fn(async (_t: string, id: string, v: Record<string, unknown>) => void articulos.push([id, v])),
    retirePublishedVersions: jest.fn(async (...a: unknown[]) => void retiradas.push(a)),
  };
  const audit = {
    record: jest.fn(async (..._a: unknown[]) => undefined),
    publish: jest.fn(async (e: never) => void publicados.push(e as Record<string, unknown>)),
  };
  const sequelize = { transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({})) };

  const service = new SupportKnowledgeService(sequelize as never, knowledge as never, {} as never, {} as never, audit as never);
  return { service, knowledge, audit, versiones, articulos, publicados, retiradas };
}

const actor = (over: Record<string, unknown> = {}) => ({ isInternal: true, actorId: '200', role: 'internal_operator', ...over }) as never;

describe('SupportKnowledgeService · quién puede tocar la base', () => {
  /* Quien no es interno no edita la base de conocimiento, aunque tenga sesión. */
  it('rechaza a quien no es interno en todo el circuito', async () => {
    const { service } = montar();
    const externo = actor({ isInternal: false });

    await expect(service.submitForReview({ tenantId: '1', actor: externo, versionId: '5', dto: {} as never })).rejects.toBeDefined();
    await expect(service.approve({ tenantId: '1', actor: externo, versionId: '5', dto: {} as never })).rejects.toBeDefined();
    await expect(service.publish({ tenantId: '1', actor: externo, versionId: '5', dto: {} as never })).rejects.toBeDefined();
  });

  it('una versión que no existe es 404, no un fallo genérico', async () => {
    const { service } = montar({ version: null as never });

    await expect(service.approve({ tenantId: '1', actor: actor(), versionId: '5', dto: {} as never })).rejects.toMatchObject({
      response: { code: 'KNOWLEDGE_VERSION_NOT_FOUND' },
    });
  });
});

describe('SupportKnowledgeService · aprobar', () => {
  /*
   * Segregación de funciones. Sin esto, «aprobado» significa solamente que el autor volvió a pulsar
   * un botón, y el control entero es decorativo.
   */
  it('quien redactó la versión no puede aprobarla', async () => {
    const { service } = montar({ version: version({ createdByInternalUserId: '200' }) });

    await expect(
      service.approve({ tenantId: '1', actor: actor({ actorId: '200' }), versionId: '5', dto: {} as never }),
    ).rejects.toMatchObject({
      response: { code: 'KNOWLEDGE_SELF_APPROVAL_FORBIDDEN' },
    });
  });

  /*
   * Un artículo de crédito, seguridad, legal, KYC, privacidad o pagos exige un rol de riesgo o
   * cumplimiento: un editor de contenido no puede cambiar unilateralmente una política publicada
   * por impecable que sea su redacción.
   */
  it('el contenido de dominio lo aprueba el dominio, no el equipo de contenido', async () => {
    for (const equipo of ['credit', 'risk', 'security', 'legal', 'kyc', 'privacy', 'payments']) {
      const { service } = montar({ articulo: articulo({ ownerTeam: equipo }) });

      await expect(
        service.approve({ tenantId: '1', actor: actor({ role: 'internal_operator' }), versionId: '5', dto: {} as never }),
      ).rejects.toMatchObject({ response: { code: 'KNOWLEDGE_DOMAIN_APPROVER_REQUIRED', ownerTeam: equipo } });
    }
  });

  it('un rol de riesgo o cumplimiento sí puede aprobar contenido de dominio', async () => {
    for (const rol of ['compliance_analyst', 'risk_analyst', 'admin', 'platform_admin']) {
      const { service, versiones } = montar({ articulo: articulo({ ownerTeam: 'credit' }) });

      await expect(
        service.approve({ tenantId: '1', actor: actor({ role: rol }), versionId: '5', dto: {} as never }),
      ).resolves.toMatchObject({
        status: 'APPROVED',
      });
      expect(versiones[0][1]).toMatchObject({ status: 'APPROVED', approvedByInternalUserId: '200' });
    }
  });

  it('un artículo que no es de dominio lo aprueba cualquier editor interno', async () => {
    const { service } = montar({ articulo: articulo({ ownerTeam: 'content' }) });

    await expect(service.approve({ tenantId: '1', actor: actor(), versionId: '5', dto: {} as never })).resolves.toMatchObject({
      status: 'APPROVED',
    });
  });

  /* Aprobar algo que no está en revisión saltaría el paso en el que alguien lo mira. */
  it('no aprueba una versión que no está en revisión', async () => {
    const { service } = montar({ version: version({ status: 'DRAFT' }) });

    await expect(service.approve({ tenantId: '1', actor: actor(), versionId: '5', dto: {} as never })).rejects.toMatchObject({
      response: { code: 'KNOWLEDGE_VERSION_NOT_IN_REVIEW', status: 'DRAFT' },
    });
  });

  it('deja constancia de quién aprobó y de qué equipo era el artículo', async () => {
    const { service, audit } = montar();

    await service.approve({ tenantId: '1', actor: actor(), versionId: '5', dto: {} as never });

    expect(audit.record.mock.calls[0][0]).toMatchObject({
      actionCode: 'support.knowledge.approve',
      targetId: '5',
      payload: { articleKey: 'como-pagar', ownerTeam: 'content' },
    });
  });
});

describe('SupportKnowledgeService · el circuito completo', () => {
  it('enviar a revisión sólo desde borrador', async () => {
    const { service, versiones } = montar({ version: version({ status: 'DRAFT' }) });

    await expect(service.submitForReview({ tenantId: '1', actor: actor(), versionId: '5', dto: {} as never })).resolves.toMatchObject({
      status: 'IN_REVIEW',
    });
    expect(versiones[0][1]).toEqual({ status: 'IN_REVIEW' });

    const otro = montar({ version: version({ status: 'PUBLISHED' }) });
    await expect(otro.service.submitForReview({ tenantId: '1', actor: actor(), versionId: '5', dto: {} as never })).rejects.toMatchObject({
      response: { code: 'KNOWLEDGE_VERSION_NOT_DRAFT' },
    });
  });

  /* Publicar sin aprobar es exactamente saltarse el control que acaba de comprobarse arriba. */
  it('no publica una versión sin aprobar', async () => {
    const { service } = montar({ version: version({ status: 'IN_REVIEW' }) });

    await expect(service.publish({ tenantId: '1', actor: actor(), versionId: '5', dto: {} as never })).rejects.toMatchObject({
      response: { code: 'KNOWLEDGE_VERSION_NOT_APPROVED' },
    });
  });

  /*
   * Retirar la anterior y publicar la nueva van en la MISMA transacción: separarlas dejaría un
   * instante con dos versiones vigentes del mismo idioma, o con ninguna.
   */
  it('publicar retira la anterior del mismo idioma dentro de la misma transacción', async () => {
    const { service, retiradas, articulos } = montar({ version: version({ status: 'APPROVED' }) });

    await service.publish({ tenantId: '1', actor: actor(), versionId: '5', dto: { retirePrevious: true } as never });

    // Artículo, idioma y la versión que se salva: retirar la anterior y publicar la nueva van
    // juntas porque separarlas dejaría un instante con dos vigentes del mismo idioma, o con ninguna.
    expect(retiradas[0].slice(0, 3)).toEqual(['9', 'es-BO', '5']);
    expect(articulos[0][1]).toMatchObject({ status: 'PUBLISHED', currentVersionId: '5' });
  });

  it('sin `retirePrevious` no toca las versiones ya publicadas', async () => {
    const { service, retiradas } = montar({ version: version({ status: 'APPROVED' }) });

    await service.publish({ tenantId: '1', actor: actor(), versionId: '5', dto: { retirePrevious: false } as never });

    expect(retiradas).toHaveLength(0);
  });

  /* El evento lleva clave de idempotencia: republicar no puede duplicar el aviso. */
  it('publica un evento idempotente por versión', async () => {
    const { service, publicados } = montar({ version: version({ status: 'APPROVED' }) });

    await service.publish({ tenantId: '1', actor: actor(), versionId: '5', dto: {} as never });

    expect(publicados[0]).toMatchObject({
      eventCode: 'support.knowledge.published',
      aggregateId: '9',
      idempotencyKey: 'knowledge-published-5',
    });
  });
});
