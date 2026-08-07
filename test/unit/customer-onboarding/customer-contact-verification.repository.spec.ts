import { describe, expect, it, jest } from '@jest/globals';
import { asyncMock, callArg, type CallArgRecord } from '../../support/jest-mocks.js';
import { CustomerContactVerificationRepository } from '../../../src/modules/customer-onboarding/repositories/customer-contact-verification.repository.js';

/**
 * Cobertura directa de `CustomerContactVerificationRepository` (Fase 1.2 del plan 10/10): método de
 * contacto del cliente y sus intentos de verificación. Sub-repo con lógica real (defaults de alta,
 * mutaciones de estado). Modelos Sequelize mockeados.
 */
describe('CustomerContactVerificationRepository', () => {
  function buildRepo() {
    const contactMethodModel = { findOne: asyncMock(), create: asyncMock() };
    const contactVerificationAttemptModel = { findOne: asyncMock(), create: asyncMock() };
    const repo = new CustomerContactVerificationRepository(contactMethodModel as never, contactVerificationAttemptModel as never);
    return { repo, contactMethodModel, contactVerificationAttemptModel };
  }

  const opts = { transaction: 'tx' as never };

  it('findCustomerContactMethod excluye borrados y prioriza el primario', async () => {
    const { repo, contactMethodModel } = buildRepo();
    (contactMethodModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findCustomerContactMethod('t1', 'c1', 'phone', opts);
    const arg = (contactMethodModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<string, unknown>; order: unknown };
    expect(arg.where).toMatchObject({ tenantId: 't1', customerId: 'c1', contactType: 'phone' });
    expect(arg.where.deleted).toBeDefined();
    expect(arg.order).toEqual([
      ['isPrimary', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('markContactMethodVerified fija verified + updatedAtValue y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => ({}));
    const contactMethod = { save } as never;
    const verifiedAt = new Date('2026-01-05');
    await repo.markContactMethodVerified(contactMethod, verifiedAt, opts);
    expect((contactMethod as { status: string; updatedAtValue: Date }).status).toBe('verified');
    expect((contactMethod as { updatedAtValue: Date }).updatedAtValue).toBe(verifiedAt);
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  it('createContactVerificationAttempt fija providerRequestId null y createdAtValue=attemptedAt', async () => {
    const { repo, contactVerificationAttemptModel } = buildRepo();
    (contactVerificationAttemptModel.create as jest.Mock).mockResolvedValue({ id: 'a1' } as never);
    const attemptedAt = new Date('2026-01-06');
    await repo.createContactVerificationAttempt(
      {
        tenantId: 't1',
        contactMethodId: 'm1',
        verificationMethod: 'otp',
        verificationStatus: 'pending',
        confidenceScore: null,
        attemptedAt,
        verifiedAt: null,
        failureReasonCode: null,
      },
      opts,
    );
    expect((contactVerificationAttemptModel.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      providerRequestId: null,
      createdAtValue: attemptedAt,
    });
  });

  it('findLatestContactVerificationAttempt ordena por attemptedAt desc', async () => {
    const { repo, contactVerificationAttemptModel } = buildRepo();
    (contactVerificationAttemptModel.findOne as jest.Mock).mockResolvedValue(null as never);
    await repo.findLatestContactVerificationAttempt('t1', 'm1');
    expect(callArg<CallArgRecord>(contactVerificationAttemptModel.findOne, 0, 0).order).toEqual([
      ['attemptedAt', 'DESC'],
      ['id', 'DESC'],
    ]);
  });

  it('updateContactVerificationAttempt copia los valores al modelo y guarda', async () => {
    const { repo } = buildRepo();
    const save = jest.fn(async (..._args: unknown[]) => ({}));
    const attempt = { save } as never;
    await repo.updateContactVerificationAttempt(
      attempt,
      { verificationStatus: 'verified', verifiedAt: new Date('2026-01-07'), failureReasonCode: null, confidenceScore: '0.9' },
      opts,
    );
    expect((attempt as { verificationStatus: string; confidenceScore: string }).verificationStatus).toBe('verified');
    expect((attempt as { confidenceScore: string }).confidenceScore).toBe('0.9');
    expect(save).toHaveBeenCalledWith({ transaction: 'tx' });
  });
});
