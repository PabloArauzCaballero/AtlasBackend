/**
 * @file Las lecturas del expediente del alta: siempre acotadas por inquilino y cliente.
 * @business Un expediente que mezclara datos de otro cliente sería una fuga, y uno que leyera sin tope, una caída.
 * @system Ejercita `OnboardingDossierRecordRepository` con modelos dobles y mira las consultas que arma.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { OnboardingDossierRecordRepository } from '../../../src/modules/customer-onboarding/repositories/onboarding-dossier-record.repository.js';

function modelo(respuestas: { findOne?: unknown; findAll?: unknown; count?: unknown } = {}) {
  return {
    findOne: jest.fn(async (..._args: unknown[]) => respuestas.findOne ?? null),
    findAll: jest.fn(async (..._args: unknown[]) => respuestas.findAll ?? []),
    count: jest.fn(async (..._args: unknown[]) => respuestas.count ?? 0),
  };
}

function build(over: Partial<Record<string, ReturnType<typeof modelo>>> = {}) {
  const m = {
    flows: modelo(),
    stepEvents: modelo(),
    documents: modelo(),
    contactMethods: modelo(),
    attempts: modelo(),
    statements: modelo(),
    evidence: modelo(),
    ...over,
  };
  const repo = new OnboardingDossierRecordRepository(
    ...([m.flows, m.stepEvents, m.documents, m.contactMethods, m.attempts, m.statements, m.evidence] as unknown as ConstructorParameters<
      typeof OnboardingDossierRecordRepository
    >),
  );
  return { repo, m };
}

const where = (mock: jest.Mock) => (mock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

describe('OnboardingDossierRecordRepository', () => {
  it('cada lectura simple va acotada por inquilino y cliente', async () => {
    const { repo, m } = build();

    await Promise.all([
      repo.findLatestFlow('t1', 'c1'),
      repo.findCurrentIdentityDocument('t1', 'c1'),
      repo.findContactMethods('t1', 'c1'),
      repo.findRecentAttempts('t1', 'c1'),
      repo.findLatestBankStatement('t1', 'c1'),
      repo.findEvidence('t1', 'c1'),
    ]);

    for (const mock of [
      m.flows.findOne,
      m.documents.findOne,
      m.contactMethods.findAll,
      m.attempts.findAll,
      m.statements.findOne,
      m.evidence.findAll,
    ]) {
      expect(where(mock as jest.Mock)).toMatchObject({ tenantId: 't1', customerId: 'c1' });
    }
    expect(where(m.documents.findOne as jest.Mock)).toMatchObject({ validUntil: null });
  });

  it('el alcance de la agenda sale del último volcado de los flujos del cliente', async () => {
    const { repo, m } = build({
      flows: modelo({ findAll: [{ id: 5 }, { id: 6 }] }),
      stepEvents: modelo({ findOne: { payloadJson: { accessScope: 'limited' } } }),
    });

    await expect(repo.findAddressBookScope('t1', 'c1')).resolves.toBe('limited');
    expect(where(m.stepEvents.findOne as jest.Mock)).toMatchObject({ tenantId: 't1', stepCode: 'address_book_synced' });
  });

  it('sin flujos, o con un volcado sin alcance, el alcance es null', async () => {
    const sinFlujos = build();
    await expect(sinFlujos.repo.findAddressBookScope('t1', 'c1')).resolves.toBeNull();
    expect(sinFlujos.m.stepEvents.findOne).not.toHaveBeenCalled();

    const sinAlcance = build({ flows: modelo({ findAll: [{ id: 5 }] }), stepEvents: modelo({ findOne: { payloadJson: null } }) });
    await expect(sinAlcance.repo.findAddressBookScope('t1', 'c1')).resolves.toBeNull();
  });
});
