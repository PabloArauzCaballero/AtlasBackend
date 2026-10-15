/**
 * @file Las lecturas del expediente del alta: siempre acotadas por inquilino y cliente.
 * @business Un expediente que mezclara datos de otro cliente sería una fuga, y uno que leyera sin tope, una caída.
 * @system Ejercita `OnboardingDossierDeviceRepository` con modelos dobles y mira las consultas que arma.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { OnboardingDossierDeviceRepository } from '../../../src/modules/customer-onboarding/repositories/onboarding-dossier-device.repository.js';

function modelo(respuestas: { findOne?: unknown; findAll?: unknown; count?: unknown } = {}) {
  return {
    findOne: jest.fn(async (..._args: unknown[]) => respuestas.findOne ?? null),
    findAll: jest.fn(async (..._args: unknown[]) => respuestas.findAll ?? []),
    count: jest.fn(async (..._args: unknown[]) => respuestas.count ?? 0),
  };
}

function build(over: Partial<Record<string, ReturnType<typeof modelo>>> = {}) {
  const m = {
    deviceLinks: modelo(),
    devices: modelo(),
    snapshots: modelo(),
    permissions: modelo(),
    consents: modelo(),
    pings: modelo(),
    deviceContacts: modelo(),
    ...over,
  };
  const repo = new OnboardingDossierDeviceRepository(
    ...([m.deviceLinks, m.devices, m.snapshots, m.permissions, m.consents, m.pings, m.deviceContacts] as unknown as ConstructorParameters<
      typeof OnboardingDossierDeviceRepository
    >),
  );
  return { repo, m };
}

const where = (mock: jest.Mock) => (mock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

describe('OnboardingDossierDeviceRepository', () => {
  it('permisos, consentimientos y agenda sincronizada van acotados por inquilino y cliente, y con tope', async () => {
    const { repo, m } = build();

    await Promise.all([repo.findPermissionEvents('t1', 'c1'), repo.findConsents('t1', 'c1'), repo.countSyncedContacts('t1', 'c1')]);

    for (const mock of [m.permissions.findAll, m.consents.findAll, m.deviceContacts.count]) {
      expect(where(mock as jest.Mock)).toMatchObject({ tenantId: 't1', customerId: 'c1' });
    }
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
});
