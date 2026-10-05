import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { Op } from 'sequelize';
import { ConsentDocumentAdminService } from '../../../src/modules/consents/consent-document-admin.service.js';

/**
 * Publicar y corregir el catálogo de consentimientos sin perder lo ya aceptado:
 * - una versión con fecha futura NO deja el código sin versión vigente hasta esa fecha;
 * - retirar y publicar van en la misma transacción;
 * - el texto de una versión que ya salió no se reescribe, y una retirada no se reactiva.
 */
function build(existing: Record<string, unknown> | null = null) {
  const transaction = { id: 'tx' };
  const documents = {
    findOne: jest.fn(async (..._args: unknown[]) => existing),
    update: jest.fn(async (..._args: unknown[]) => [1]),
    create: jest.fn(async (values: Record<string, unknown>) => ({ id: '9', ...values })),
    sequelize: { transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(transaction)) },
  };
  return { documents, transaction, service: new ConsentDocumentAdminService(documents as never) };
}

const input = {
  documentCode: 'terms',
  versionCode: 'v2',
  language: 'es',
  title: 'Términos',
  bodyMarkdown: 'Texto completo de los términos v2.',
  requiresExplicitAction: true,
};

function stored(overrides: Record<string, unknown> = {}) {
  const document = {
    id: '5',
    status: 'published',
    title: 'Términos',
    summary: null,
    bodyMd: 'Texto original que el cliente leyó.',
    contentUrl: null,
    requiresExplicitAction: true,
    publishedByInternalUserId: 'u-publicó',
    ...overrides,
    save: jest.fn(async () => undefined),
  };
  return document;
}

describe('ConsentDocumentAdminService.publish', () => {
  it('con fecha futura la vigente sigue publicada: sólo se le acorta la vigencia', async () => {
    const { documents, service, transaction } = build();

    await service.publish('t1', { ...input, effectiveFrom: '2999-01-01' } as never, 'u1');

    const [values, options] = documents.update.mock.calls[0] as [
      Record<string, unknown>,
      { where: Record<string | symbol, unknown>; transaction: unknown },
    ];
    expect(values).toEqual({ effectiveUntil: '2999-01-01', updatedAtValue: expect.any(Date) });
    expect(values).not.toHaveProperty('status');
    expect(options.transaction).toBe(transaction);
    expect(options.where).toMatchObject({ tenantId: 't1', documentCode: 'terms', language: 'es', status: 'published' });
    expect(options.where[Op.or]).toEqual([{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: '2999-01-01' } }]);
    expect(documents.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'published', effectiveFrom: '2999-01-01' }), {
      transaction,
    });
  });

  it('con fecha de hoy o pasada retira la anterior, dentro de la misma transacción', async () => {
    const { documents, service, transaction } = build();

    await service.publish('t1', { ...input, effectiveFrom: '2020-01-01' } as never, 'u1');

    const [values, options] = documents.update.mock.calls[0] as [Record<string, unknown>, { transaction: unknown }];
    expect(values).toMatchObject({ status: 'retired', effectiveUntil: '2020-01-01' });
    expect(options.transaction).toBe(transaction);
    expect(documents.sequelize.transaction).toHaveBeenCalledTimes(1);
  });

  it('una versión repetida se rechaza sin retirar nada', async () => {
    const { documents, service } = build(stored());

    await expect(service.publish('t1', { ...input, effectiveFrom: '2020-01-01' } as never, 'u1')).rejects.toThrow(
      'CONSENT_VERSION_ALREADY_EXISTS',
    );
    expect(documents.update).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
  });
});

describe('ConsentDocumentAdminService.update', () => {
  it('no reescribe el texto de una versión publicada', async () => {
    const document = stored();
    const { service } = build(document);

    await expect(service.update('t1', '5', { bodyMarkdown: 'Otro texto que nadie aceptó.' } as never, 'u2')).rejects.toThrow(
      new ConflictException('CONSENT_DOCUMENT_PUBLISHED_IS_IMMUTABLE'),
    );
    expect(document.save).not.toHaveBeenCalled();
    expect(document.bodyMd).toBe('Texto original que el cliente leyó.');
  });

  it('no cambia la URL ni la obligatoriedad de una retirada', async () => {
    const { service } = build(stored({ status: 'retired' }));

    await expect(service.update('t1', '5', { requiresExplicitAction: false } as never, 'u2')).rejects.toThrow(
      'CONSENT_DOCUMENT_PUBLISHED_IS_IMMUTABLE',
    );
    await expect(service.update('t1', '5', { contentUrl: 'https://x.test/otro.pdf' } as never, 'u2')).rejects.toThrow(
      'CONSENT_DOCUMENT_PUBLISHED_IS_IMMUTABLE',
    );
  });

  it('no reactiva una retirada ni publica un borrador: publicar es `publish`', async () => {
    await expect(build(stored({ status: 'retired' })).service.update('t1', '5', { status: 'published' } as never, 'u2')).rejects.toThrow(
      'CONSENT_DOCUMENT_PUBLISH_REQUIRES_NEW_VERSION',
    );
    await expect(build(stored({ status: 'draft' })).service.update('t1', '5', { status: 'published' } as never, 'u2')).rejects.toThrow(
      'CONSENT_DOCUMENT_PUBLISH_REQUIRES_NEW_VERSION',
    );
    await expect(build(stored({ status: 'retired' })).service.update('t1', '5', { status: 'draft' } as never, 'u2')).rejects.toThrow(
      'CONSENT_DOCUMENT_PUBLISHED_IS_IMMUTABLE',
    );
  });

  it('corrige una errata del título, reenviar el mismo texto no es cambio, y no pisa quién publicó', async () => {
    const document = stored();
    const { service } = build(document);

    await service.update(
      't1',
      '5',
      { title: 'Términos y condiciones', bodyMarkdown: 'Texto original que el cliente leyó.' } as never,
      'u2',
    );

    expect(document.save).toHaveBeenCalled();
    expect(document.title).toBe('Términos y condiciones');
    expect(document.publishedByInternalUserId).toBe('u-publicó');
  });

  it('se puede retirar una publicada', async () => {
    const document = stored();
    await build(document).service.update('t1', '5', { status: 'retired' } as never, 'u2');
    expect(document.status).toBe('retired');
  });

  it('un borrador sí admite cambios de fondo', async () => {
    const document = stored({ status: 'draft' });
    await build(document).service.update('t1', '5', { bodyMarkdown: 'Texto nuevo del borrador, todavía sin publicar.' } as never, 'u2');
    expect(document.bodyMd).toBe('Texto nuevo del borrador, todavía sin publicar.');
  });

  it('404 si no existe en el tenant', async () => {
    await expect(build(null).service.update('t1', '5', { title: 'x' } as never, 'u2')).rejects.toThrow('CONSENT_DOCUMENT_NOT_FOUND');
  });
});
