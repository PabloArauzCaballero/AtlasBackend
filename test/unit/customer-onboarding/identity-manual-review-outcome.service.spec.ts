/**
 * @file La resolución de una revisión humana de identidad cae sobre EL intento revisado, y sólo sobre él.
 * @business Un cliente que reintentó la verificación desde el móvil tiene dos intentos abiertos a la vez:
 *   uno ya verificado y otro esperando a un analista. Que la decisión del analista pise el equivocado
 *   convierte a un cliente verificado en rechazado (o al revés) sin que nadie lo haya decidido, y deja
 *   el caso que sí se revisó esperando para siempre.
 * @system Ejercita el callback del Motor (`IdentityReviewCallbackController`) contra el servicio real
 *   (`IdentityManualReviewOutcomeService`) con un repositorio en memoria que guarda los intentos, de
 *   modo que lo que se comprueba es la fila que quedó escrita y no las llamadas que hizo el código.
 */
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { env } from '../../../src/config/env.js';
import { IdentityManualReviewOutcomeService } from '../../../src/modules/customer-onboarding/application/identity-manual-review-outcome.service.js';
import { IdentityReviewCallbackController } from '../../../src/modules/customer-onboarding/identity-review-callback.controller.js';

type Attempt = {
  id: string;
  customerId: string | null;
  verificationChannel: string;
  finalResult: string | null;
  reasonCodesJson: Record<string, unknown> | null;
  completedAt: Date | null;
  manualReviewedBy: string | null;
  manualReviewNotes: string | null;
};

const TENANT = '1';
const CUSTOMER = '10';
const CLAVE = 'clave-del-motor';

function attempt(values: Partial<Attempt> & Pick<Attempt, 'id'>): Attempt {
  return {
    customerId: CUSTOMER,
    verificationChannel: 'MOBILE_APP',
    finalResult: 'PENDING',
    reasonCodesJson: null,
    completedAt: null,
    manualReviewedBy: null,
    manualReviewNotes: null,
    ...values,
  };
}

/**
 * Repositorio en memoria. `findLatestAttempt` queda ahí a propósito: es lo que el servicio usaba
 * antes, y si vuelve a llamarlo esta prueba tiene que notarlo por el estado de las filas.
 */
function build(rows: Attempt[]) {
  const byId = (id: string) => rows.find((row) => row.id === id) ?? null;
  const newestFirst = (customerId: string) =>
    rows.filter((row) => row.customerId === customerId).sort((a, b) => Number(b.id) - Number(a.id));

  const repository = {
    findAttemptByExecutionId: jest.fn(
      async (_tenant: string, executionId: string) => rows.find((row) => row.reasonCodesJson?.executionId === executionId) ?? null,
    ),
    findAttemptById: jest.fn(async (_tenant: string, id: string) => byId(id)),
    findAttemptAwaitingReview: jest.fn(async (_tenant: string, customerId: string) => {
      const attempts = newestFirst(customerId);
      const open = attempts.find((row) => !['verified', 'rejected'].includes((row.finalResult ?? '').toLowerCase()));
      return open ?? attempts[0] ?? null;
    }),
    findLatestAttempt: jest.fn(async (_tenant: string, customerId: string) => newestFirst(customerId)[0] ?? null),
    resolveAttempt: jest.fn(
      async (row: Attempt, values: { finalResult: string; reviewedBy: string | null; notes: string | null; now: Date }) => {
        row.finalResult = values.finalResult;
        row.completedAt = values.now;
        row.manualReviewedBy = values.reviewedBy;
        row.manualReviewNotes = values.notes;
        return row;
      },
    ),
    resolveIdentityDocument: jest.fn(async (..._args: unknown[]) => undefined),
    findPendingReviews: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    resolveReview: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const lifecycle = { advance: jest.fn(async (..._args: unknown[]) => undefined) };
  const sequelize = { transaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback({})) };

  const service = new IdentityManualReviewOutcomeService(repository as never, lifecycle as never, sequelize as never);
  const controller = new IdentityReviewCallbackController(service, repository as never);
  return { service, controller, repository, lifecycle };
}

function snapshot(row: Attempt): Attempt {
  return { ...row, reasonCodesJson: row.reasonCodesJson ? { ...row.reasonCodesJson } : null };
}

describe('la resolución de una revisión humana de identidad', () => {
  const original = env.ENGINE_CALLBACK_API_KEY;

  beforeEach(() => {
    (env as { ENGINE_CALLBACK_API_KEY?: string }).ENGINE_CALLBACK_API_KEY = CLAVE;
  });

  afterAll(() => {
    (env as { ENGINE_CALLBACK_API_KEY?: string }).ENGINE_CALLBACK_API_KEY = original;
  });

  describe('callback del Motor', () => {
    it('FALLA sin el fix: el intento del móvil ya VERIFIED, que es más reciente, no se toca al resolver el que estaba en revisión (I-3)', async () => {
      // Antes: el controlador localizaba el intento por `executionId` (el 21) y el servicio volvía a
      // buscar "el último del cliente" (el 22, verificado) y escribía el rechazo sobre ÉL.
      const enRevision = attempt({
        id: '21',
        finalResult: 'IN_REVIEW',
        reasonCodesJson: { executionId: 'exec-revision' },
      });
      const yaVerificado = attempt({
        id: '22',
        finalResult: 'VERIFIED',
        reasonCodesJson: { executionId: 'exec-otro' },
        completedAt: new Date('2026-09-20T10:00:00Z'),
      });
      const { controller } = build([enRevision, yaVerificado]);
      const antesDelVerificado = snapshot(yaVerificado);

      const resultado = await controller.aplicar(TENANT, CLAVE, {
        executionId: 'exec-revision',
        decision: 'DECLINE',
        resolvedByInternalUserId: '7',
      });

      // El revisado quedó resuelto, en el vocabulario del canal móvil que la app lee tal cual…
      expect(enRevision.finalResult).toBe('REJECTED');
      expect(enRevision.manualReviewedBy).toBe('7');
      expect(enRevision.completedAt).toBeInstanceOf(Date);
      // …y el otro intento del cliente sigue exactamente como estaba.
      expect(yaVerificado).toEqual(antesDelVerificado);
      expect(resultado).toMatchObject({ customerId: CUSTOMER, identityResult: 'rejected' });
    });

    it('aprobar deja el intento revisado en VERIFIED con el vocabulario del móvil, y el resultado se lee como verified', async () => {
      const enRevision = attempt({ id: '31', finalResult: 'IN_REVIEW', reasonCodesJson: { executionId: 'exec-a' } });
      const { controller } = build([enRevision]);

      const resultado = await controller.aplicar(TENANT, CLAVE, {
        executionId: 'exec-a',
        decision: 'APPROVE',
        resolvedByInternalUserId: '7',
      });

      expect(enRevision.finalResult).toBe('VERIFIED');
      expect(resultado).toMatchObject({ identityResult: 'verified' });
    });

    it('no resuelve nada si ningún intento nació de esa ejecución', async () => {
      const otro = attempt({ id: '41', finalResult: 'IN_REVIEW', reasonCodesJson: { executionId: 'exec-x' } });
      const { controller, repository } = build([otro]);
      const antes = snapshot(otro);

      await expect(controller.aplicar(TENANT, CLAVE, { executionId: 'exec-que-no-existe', decision: 'APPROVE' })).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(repository.resolveAttempt).not.toHaveBeenCalled();
      expect(otro).toEqual(antes);
    });
  });

  describe('servicio', () => {
    it('resuelve exactamente el intento que se le indica, aunque haya otro más reciente del mismo cliente', async () => {
      const revisado = attempt({ id: '51', finalResult: 'IN_REVIEW' });
      const masReciente = attempt({ id: '52', finalResult: 'REJECTED' });
      const { service, repository } = build([revisado, masReciente]);

      await service.apply({ tenantId: TENANT, attemptId: '51', decision: 'approved', reviewedByInternalUserId: null, notes: 'ok' });

      expect(revisado.finalResult).toBe('VERIFIED');
      expect(masReciente.finalResult).toBe('REJECTED');
      // El servicio ya no pregunta por «el último del cliente».
      expect(repository.findLatestAttempt).not.toHaveBeenCalled();
    });

    it('sobre una fila del canal directo escribe en minúsculas, el vocabulario de esa fila', async () => {
      const delPaquete = attempt({ id: '61', verificationChannel: 'onboarding_package', finalResult: 'pending_review' });
      const { service } = build([delPaquete]);

      await service.apply({ tenantId: TENANT, attemptId: '61', decision: 'approved', reviewedByInternalUserId: '9', notes: 'ok' });

      expect(delPaquete.finalResult).toBe('verified');
    });

    it('un intento que no existe es 404 y no toca nada', async () => {
      const { service, repository } = build([]);

      await expect(
        service.apply({ tenantId: TENANT, attemptId: '999', decision: 'approved', reviewedByInternalUserId: null, notes: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.resolveAttempt).not.toHaveBeenCalled();
    });

    it('un intento sin cliente no tiene expediente al que propagar la decisión: 422 y no toca nada', async () => {
      const anonimo = attempt({ id: '71', customerId: null, finalResult: 'IN_REVIEW' });
      const { service, repository } = build([anonimo]);

      await expect(
        service.apply({ tenantId: TENANT, attemptId: '71', decision: 'approved', reviewedByInternalUserId: null, notes: 'x' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repository.resolveAttempt).not.toHaveBeenCalled();
      expect(anonimo.finalResult).toBe('IN_REVIEW');
    });
  });

  describe('por cliente (el endpoint del operador, sin intento)', () => {
    it('FALLA sin el fix: resuelve el intento que ESPERA decisión y no el último, que es un VERIFIED del otro canal', async () => {
      const esperando = attempt({ id: '81', verificationChannel: 'onboarding_package', finalResult: 'pending_review' });
      const yaVerificado = attempt({ id: '82', finalResult: 'VERIFIED' });
      const { service } = build([esperando, yaVerificado]);
      const antes = snapshot(yaVerificado);

      await service.applyForCustomer({
        tenantId: TENANT,
        customerId: CUSTOMER,
        decision: 'rejected',
        reviewedByInternalUserId: '7',
        notes: 'documento ilegible',
      });

      expect(esperando.finalResult).toBe('rejected');
      expect(yaVerificado).toEqual(antes);
    });

    it('un cliente sin ningún intento es 404', async () => {
      const { service } = build([]);

      await expect(
        service.applyForCustomer({
          tenantId: TENANT,
          customerId: CUSTOMER,
          decision: 'approved',
          reviewedByInternalUserId: null,
          notes: 'x',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
