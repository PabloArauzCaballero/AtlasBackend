import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { CustomerVerificationRepository } from '../../../src/modules/customer-onboarding/repositories/customer-verification.repository.js';
import type {
  CustomerIdentityDocumentModel,
  EvidenceDocumentModel,
  EvidenceReviewModel,
  IdentityVerificationAttemptModel,
  WatchlistEntryModel,
  WatchlistMatchModel,
} from '../../../src/database/models/index.js';

/**
 * Resolución de identidad y screening de cumplimiento.
 *
 * Lo que se fija son los dos puentes que sostienen la decisión humana. El primero: el intento se
 * localiza por el `executionId` que guarda entre sus códigos de motivo, y es lo ÚNICO que ata las
 * dos bases —el Motor conoce su ejecución pero no sabe de qué cliente es, a propósito—; sin esa
 * búsqueda, cuando el analista resuelve la revisión no hay a quién aplicársela. El segundo: el
 * cotejo contra listas restrictivas es por HASH y nunca por el valor en claro, y las listas globales
 * (`_tenant_id` nulo) aplican a todos los tenants sin que una entrada caducada siga golpeando.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock };

function doble(): Doble {
  return { create: jest.fn(async () => ({ id: 'x' })), findOne: jest.fn(async () => null), findAll: jest.fn(async () => []) };
}

function ultima(mock: jest.Mock): {
  where: Record<string | symbol, unknown>;
  order?: unknown[];
  attributes?: string[];
  transaction?: unknown;
} {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

describe('CustomerVerificationRepository', () => {
  let attempts: Doble & { sequelize: { escape: jest.Mock } };
  let evidence: Doble;
  let reviews: Doble;
  let identityDocuments: Doble;
  let watchlistEntries: Doble;
  let watchlistMatches: Doble;
  let repo: CustomerVerificationRepository;
  const tx = {} as never;

  beforeEach(() => {
    attempts = { ...doble(), sequelize: { escape: jest.fn((valor: string) => `'${valor}'`) } } as never;
    evidence = doble();
    reviews = doble();
    identityDocuments = doble();
    watchlistEntries = doble();
    watchlistMatches = doble();
    repo = new CustomerVerificationRepository(
      attempts as unknown as typeof IdentityVerificationAttemptModel,
      evidence as unknown as typeof EvidenceDocumentModel,
      reviews as unknown as typeof EvidenceReviewModel,
      identityDocuments as unknown as typeof CustomerIdentityDocumentModel,
      watchlistEntries as unknown as typeof WatchlistEntryModel,
      watchlistMatches as unknown as typeof WatchlistMatchModel,
    );
  });

  describe('el intento de verificación', () => {
    it('se busca por el `executionId` guardado en los códigos de motivo, escapado y acotado al tenant', async () => {
      await repo.findAttemptByExecutionId('t1', "exe-1' OR 1=1");

      expect(attempts.sequelize.escape).toHaveBeenCalledWith("exe-1' OR 1=1");
      const condicion = ultima(attempts.findOne).where;
      expect(condicion.tenantId).toBe('t1');
      expect(String((condicion[Op.and] as Array<{ val: string }>)[0].val)).toContain("reason_codes_json->>'executionId' = 'exe-1' OR 1=1'");
    });

    it('el último intento de un cliente es el de id más alto', async () => {
      await repo.findLatestAttempt('t1', 'c1');

      expect(ultima(attempts.findOne).where).toEqual({ tenantId: 't1', customerId: 'c1' });
      expect(ultima(attempts.findOne).order).toEqual([['id', 'DESC']]);
    });

    it('resolverlo escribe el resultado, quién revisó y cuándo, dentro de la transacción', async () => {
      const save = jest.fn(async (_opciones?: unknown) => undefined);
      const intento = { save } as unknown as IdentityVerificationAttemptModel;
      const ahora = new Date('2026-09-10T10:00:00Z');

      await repo.resolveAttempt(intento, { finalResult: 'approved', reviewedBy: '7', notes: 'ok', now: ahora }, { transaction: tx });

      expect(intento.finalResult).toBe('approved');
      expect(intento.completedAt).toBe(ahora);
      expect(intento.manualReviewedBy).toBe('7');
      expect(intento.manualReviewNotes).toBe('ok');
      expect(save).toHaveBeenCalledWith({ transaction: tx });
    });

    it('de qué cliente es un intento sólo pide esa columna y devuelve texto', async () => {
      attempts.findOne.mockResolvedValueOnce({ customerId: 42 } as never);

      await expect(repo.findCustomerIdByAttempt('t1', 'a1')).resolves.toBe('42');
      expect(ultima(attempts.findOne).attributes).toEqual(['customerId']);
    });

    it('un intento inexistente devuelve null en vez de la cadena «undefined»', async () => {
      attempts.findOne.mockResolvedValueOnce(null as never);
      await expect(repo.findCustomerIdByAttempt('t1', 'a1')).resolves.toBeNull();
    });
  });

  describe('el documento de identidad', () => {
    it('el último es el de id más alto, acotado al cliente y al tenant', async () => {
      await repo.findLatestIdentityDocument('t1', 'c1');

      expect(ultima(identityDocuments.findOne).where).toEqual({ tenantId: 't1', customerId: 'c1' });
      expect(ultima(identityDocuments.findOne).order).toEqual([['id', 'DESC']]);
    });

    it('aprobarlo sella la fecha; cualquier otro desenlace la deja nula', async () => {
      const ahora = new Date('2026-09-10T10:00:00Z');
      const documento = { save: jest.fn(async (_opciones?: unknown) => undefined) } as unknown as CustomerIdentityDocumentModel;

      identityDocuments.findOne.mockResolvedValueOnce(documento as never);
      await repo.resolveIdentityDocument('t1', 'c1', { verificationStatus: 'verified', now: ahora }, { transaction: tx });
      expect(documento.verifiedAt).toBe(ahora);

      identityDocuments.findOne.mockResolvedValueOnce(documento as never);
      await repo.resolveIdentityDocument('t1', 'c1', { verificationStatus: 'rejected', now: ahora }, { transaction: tx });
      expect(documento.verificationStatus).toBe('rejected');
      expect(documento.verifiedAt).toBeNull();
    });

    it('sin documento no falla: el cliente puede no haber subido nada todavía', async () => {
      identityDocuments.findOne.mockResolvedValueOnce(null as never);

      await expect(
        repo.resolveIdentityDocument('t1', 'c1', { verificationStatus: 'verified', now: new Date() }, { transaction: tx }),
      ).resolves.toBeUndefined();
    });
  });

  describe('la evidencia que mira el analista', () => {
    it('se listan los documentos vivos del cliente, en el orden en que llegaron', async () => {
      await repo.findEvidenceDocuments('t1', 'c1');

      const condicion = ultima(evidence.findAll).where;
      expect(condicion).toMatchObject({ tenantId: 't1', customerId: 'c1' });
      expect((condicion.deleted as Record<symbol, boolean>)[Op.ne]).toBe(true);
      expect(ultima(evidence.findAll).order).toEqual([['id', 'ASC']]);
    });

    it('las revisiones pendientes son las de sus documentos y las que aún no están aceptadas', async () => {
      evidence.findAll.mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as never);

      await repo.findPendingReviews('t1', 'c1');

      const condicion = ultima(reviews.findAll).where;
      expect((condicion.evidenceDocumentId as Record<symbol, string[]>)[Op.in]).toEqual(['1', '2']);
      expect((condicion.reviewStatus as Record<symbol, string[]>)[Op.notIn]).toEqual(['approved', 'accepted']);
    });

    it('sin documentos no se consulta la tabla de revisiones: un `IN ()` vacío las traería todas', async () => {
      evidence.findAll.mockResolvedValueOnce([] as never);

      await expect(repo.findPendingReviews('t1', 'c1')).resolves.toEqual([]);
      expect(reviews.findAll).not.toHaveBeenCalled();
    });

    it('resolver una revisión escribe desenlace, motivo de rechazo, revisor y fecha', async () => {
      const ahora = new Date('2026-09-10T10:00:00Z');
      const revision = { save: jest.fn(async (_opciones?: unknown) => undefined) } as unknown as EvidenceReviewModel;

      await repo.resolveReview(
        revision,
        { reviewStatus: 'rejected', reviewedBy: '7', rejectionReasonCode: 'BLURRY', notes: 'ilegible', now: ahora },
        { transaction: tx },
      );

      expect(revision.reviewStatus).toBe('rejected');
      expect(revision.rejectionReasonCode).toBe('BLURRY');
      expect(revision.reviewedAt).toBe(ahora);
      expect(revision.save).toHaveBeenCalledWith({ transaction: tx });
    });
  });

  describe('listas restrictivas', () => {
    it('el cotejo es por hash, sólo sobre entradas activas y no borradas', async () => {
      const ahora = new Date('2026-09-10T10:00:00Z');
      await repo.findActiveEntriesByHashes('t1', ['h1', 'h2'], ahora);

      const condicion = ultima(watchlistEntries.findAll).where;
      expect((condicion.entityHash as Record<symbol, string[]>)[Op.in]).toEqual(['h1', 'h2']);
      expect(condicion.status).toBe('active');
      expect((condicion.deleted as Record<symbol, boolean>)[Op.ne]).toBe(true);
    });

    it('las listas globales aplican a todos los tenants y lo caducado ya no golpea', async () => {
      const ahora = new Date('2026-09-10T10:00:00Z');
      await repo.findActiveEntriesByHashes('t1', ['h1'], ahora);

      const [porTenant, porVigencia] = ultima(watchlistEntries.findAll).where[Op.and] as Array<Record<symbol, unknown[]>>;
      expect(porTenant[Op.or]).toEqual([{ tenantId: null }, { tenantId: 't1' }]);
      expect((porVigencia[Op.or] as Array<Record<string, unknown>>)[0]).toEqual({ expiresAt: null });
      expect((porVigencia[Op.or] as Array<{ expiresAt: Record<symbol, Date> }>)[1].expiresAt[Op.gt]).toBe(ahora);
    });

    it('sin hashes que cotejar no se consulta la lista', async () => {
      await expect(repo.findActiveEntriesByHashes('t1', [], new Date())).resolves.toEqual([]);
      expect(watchlistEntries.findAll).not.toHaveBeenCalled();
    });

    it('las coincidencias de un cliente se leen acotadas al tenant', async () => {
      await repo.findMatches('t1', 'c1', { transaction: tx });

      expect(ultima(watchlistMatches.findAll).where).toEqual({ tenantId: 't1', customerId: 'c1' });
      expect(ultima(watchlistMatches.findAll).transaction).toBe(tx);
    });

    it('una coincidencia nace sin caso abierto: abrirlo es una decisión aparte', async () => {
      const ahora = new Date('2026-09-10T10:00:00Z');

      await repo.createMatch(
        {
          tenantId: 't1',
          watchlistEntryId: 'w1',
          customerId: 'c1',
          matchedEntityType: 'document',
          matchedValueHash: 'h1',
          matchMethod: 'exact_hash',
          matchConfidence: '1.00',
          matchedAt: ahora,
        },
        { transaction: tx },
      );

      expect(watchlistMatches.create).toHaveBeenCalledWith(
        expect.objectContaining({ openedReviewCaseId: null, openedFraudCaseId: null, createdAtValue: ahora }),
        { transaction: tx },
      );
    });

    it('descartar una coincidencia la borra dentro de la transacción', async () => {
      const destroy = jest.fn(async (_opciones?: unknown) => undefined);

      await repo.clearMatch({ destroy } as unknown as WatchlistMatchModel, { transaction: tx });

      expect(destroy).toHaveBeenCalledWith({ transaction: tx });
    });
  });
});
