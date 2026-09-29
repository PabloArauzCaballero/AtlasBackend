/**
 * @file Las lecturas del expediente del alta: siempre acotadas por inquilino y cliente.
 * @business Un expediente que mezclara datos de otro cliente sería una fuga, y uno que leyera sin tope, una caída.
 * @system Ejercita `OnboardingReviewDossierRepository` con modelos dobles y mira las consultas que arma.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { OnboardingReviewDossierRepository } from '../../../src/modules/customer-onboarding/repositories/onboarding-review-dossier.repository.js';

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
    deviceLinks: modelo(),
    devices: modelo(),
    snapshots: modelo(),
    permissions: modelo(),
    consents: modelo(),
    pings: modelo(),
    deviceContacts: modelo(),
    evidence: modelo(),
    ...over,
  };
  const repo = new OnboardingReviewDossierRepository(
    ...([
      m.flows,
      m.stepEvents,
      m.documents,
      m.contactMethods,
      m.attempts,
      m.statements,
      m.deviceLinks,
      m.devices,
      m.snapshots,
      m.permissions,
      m.consents,
      m.pings,
      m.deviceContacts,
      m.evidence,
    ] as unknown as ConstructorParameters<typeof OnboardingReviewDossierRepository>),
  );
  return { repo, m };
}

const where = (mock: jest.Mock) => (mock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

describe('OnboardingReviewDossierRepository', () => {
  it('cada lectura simple va acotada por inquilino y cliente', async () => {
    const { repo, m } = build();

    await Promise.all([
      repo.findLatestFlow('t1', 'c1'),
      repo.findCurrentIdentityDocument('t1', 'c1'),
      repo.findContactMethods('t1', 'c1'),
      repo.findRecentAttempts('t1', 'c1'),
      repo.findLatestBankStatement('t1', 'c1'),
      repo.findPermissionEvents('t1', 'c1'),
      repo.findConsents('t1', 'c1'),
      repo.countSyncedContacts('t1', 'c1'),
      repo.findEvidence('t1', 'c1'),
    ]);

    for (const mock of [
      m.flows.findOne,
      m.documents.findOne,
      m.contactMethods.findAll,
      m.attempts.findAll,
      m.statements.findOne,
      m.permissions.findAll,
      m.consents.findAll,
      m.deviceContacts.count,
      m.evidence.findAll,
    ]) {
      expect(where(mock as jest.Mock)).toMatchObject({ tenantId: 't1', customerId: 'c1' });
    }
    expect(where(m.documents.findOne as jest.Mock)).toMatchObject({ validUntil: null });
    expect((m.permissions.findAll.mock.calls[0]![0] as { limit: number }).limit).toBeGreaterThan(0);
  });

  it('los pings: con tope, del más viejo al más nuevo', async () => {
    const { repo, m } = build({ pings: modelo({ findAll: [{ id: 3 }, { id: 2 }, { id: 1 }] }) });

    const pings = await repo.findPings('t1', 'c1');

    expect(pings.map((p) => (p as unknown as { id: number }).id)).toEqual([1, 2, 3]);
    const opciones = m.pings.findAll.mock.calls[0]![0] as { where: unknown; limit: number };
    expect(opciones.where).toEqual({ tenantId: 't1', customerId: 'c1' });
    expect(opciones.limit).toBeGreaterThan(0);
  });

  it('sin vínculo de dispositivo no hay dispositivo', async () => {
    const { repo, m } = build();

    await expect(repo.findDevice('t1', 'c1')).resolves.toBeNull();
    expect(m.devices.findOne).not.toHaveBeenCalled();
  });

  it('el dispositivo: huella, última foto y cuántos OTROS clientes del inquilino lo usan', async () => {
    const { repo, m } = build({
      deviceLinks: modelo({ findOne: { deviceId: 'd9', firstSeenAt: null }, count: 3 }),
      devices: modelo({ findOne: { deviceFingerprint: 'abc' } }),
      snapshots: modelo({ findOne: { brand: 'x' } }),
    });

    const leido = await repo.findDevice('t1', 'c1');

    expect(leido).toMatchObject({ device: { deviceFingerprint: 'abc' }, snapshot: { brand: 'x' }, otrosClientes: 3 });
    expect(where(m.devices.findOne as jest.Mock)).toEqual({ tenantId: 't1', id: 'd9' });
    expect(where(m.snapshots.findOne as jest.Mock)).toEqual({ tenantId: 't1', deviceId: 'd9' });
    const otros = where(m.deviceLinks.count as jest.Mock) as Record<string, unknown>;
    expect(otros).toMatchObject({ tenantId: 't1', deviceId: 'd9' });
    expect(otros.customerId).toEqual({ [Op.ne]: 'c1' });
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
