import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  actorOf,
  CARD_TIER_OVERRIDE_REVOKED,
  CARD_TIER_OVERRIDE_SET,
  CardTierService,
  type CardTierActor,
} from '../../../src/modules/credit/application/card-tier.service.js';
import { DEFAULT_CARD_TIERS } from '../../../src/modules/credit/domain/card-tier.js';

/**
 * Poner y quitar una tarjeta a mano: siempre con motivo, siempre auditado, nunca dos a la vez, y si algo falla a mitad
 * no queda nada a medias (todo va en una transacción).
 */
const AHORA = new Date('2026-10-03T12:00:00Z');
const ACTOR: CardTierActor = { actorType: 'internal_user', internalUserId: '7', platformUserId: null };

type Fila = {
  id: string;
  tenantId: string;
  customerId: string;
  tierCode: string;
  reason: string;
  validFrom: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedByInternalUserId: string | null;
  revokeReason: string | null;
  update: jest.Mock<(valores: Partial<Fila>, opciones?: unknown) => Promise<unknown>>;
};

function fila(extra: Partial<Fila> = {}): Fila {
  const f: Fila = {
    id: '1',
    tenantId: '1',
    customerId: '42',
    tierCode: 'GOLD',
    reason: 'Cliente fundador',
    validFrom: new Date('2026-09-01T00:00:00Z'),
    expiresAt: null,
    revokedAt: null,
    revokedByInternalUserId: null,
    revokeReason: null,
    update: jest.fn(async (valores: Partial<Fila>, _opciones?: unknown) => Object.assign(f, valores)),
    ...extra,
  };
  return f;
}

function armar(opciones: { abiertos?: Fila[]; catalogoDelTenant?: unknown[] } = {}) {
  const abiertos = opciones.abiertos ?? [];
  const tiers = { findAll: jest.fn(async (_o: unknown) => opciones.catalogoDelTenant ?? []) };
  const overrides = {
    findAll: jest.fn(async (_o: unknown) => abiertos),
    create: jest.fn(async (valores: Record<string, unknown>, _opciones?: unknown) => fila({ id: '99', ...(valores as Partial<Fila>) })),
  };
  const audit = { create: jest.fn(async (_v: Record<string, unknown>, _o: unknown) => ({})) };
  const transaccion = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = { transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(transaccion)) };
  const service = new CardTierService(tiers as never, overrides as never, audit as never, sequelize as never);
  return { service, tiers, overrides, audit, sequelize, transaccion };
}

describe('catalog', () => {
  it('pide las tarjetas ordenadas de menor a mayor y sólo las activas', async () => {
    const { service, tiers } = armar({ catalogoDelTenant: [] });
    await service.catalog('1');
    expect(tiers.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: '1', deleted: false, isActive: true }, order: [['displayOrder', 'ASC']] }),
    );
  });

  it('sin catálogo en la base usa el de fábrica: nadie se queda sin tarjeta por un tenant nuevo', async () => {
    const { service } = armar({ catalogoDelTenant: [] });
    expect((await service.catalog('1')).map((t) => t.code)).toEqual(DEFAULT_CARD_TIERS.map((t) => t.code));
  });
});

describe('resolveFor', () => {
  it('sin ajuste, la tarjeta es la de su nivel', async () => {
    const { service } = armar();
    const v = await service.resolveFor('1', '42', 'ESTABLECIDO', AHORA);
    expect(v.tier.code).toBe('GOLD');
    expect(v.source).toBe('AUTOMATICA');
    expect(v.manual).toBeNull();
  });

  it('con un ajuste vigente manda el ajuste y dice desde cuándo y hasta cuándo', async () => {
    const vence = new Date('2026-12-01T00:00:00Z');
    const { service } = armar({ abiertos: [fila({ tierCode: 'PREMIUM', expiresAt: vence })] });
    const v = await service.resolveFor('1', '42', 'NUEVO', AHORA);
    expect(v.tier.code).toBe('PREMIUM');
    expect(v.source).toBe('MANUAL');
    expect(v.automaticTier.code).toBe('NORMAL');
    expect(v.manual).toEqual({ since: new Date('2026-09-01T00:00:00Z'), expiresAt: vence });
  });

  it('un ajuste que ya venció no vale aunque siga sin revocar', async () => {
    const { service } = armar({ abiertos: [fila({ tierCode: 'BLACK', expiresAt: new Date('2026-10-01T00:00:00Z') })] });
    const v = await service.resolveFor('1', '42', 'NUEVO', AHORA);
    expect(v.source).toBe('AUTOMATICA');
    expect(v.tier.code).toBe('NORMAL');
  });
});

describe('setOverride', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('crea el ajuste con su motivo, quién lo puso y la auditoría, todo en una transacción', async () => {
    const { service, overrides, audit, sequelize } = armar();
    await service.setOverride({
      tenantId: '1',
      customerId: '42',
      tierCode: 'GOLD',
      reason: '  Cliente fundador de la red  ',
      expiresAt: null,
      actor: ACTOR,
      now: AHORA,
    });

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(overrides.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '1',
        customerId: '42',
        tierCode: 'GOLD',
        reason: 'Cliente fundador de la red',
        setByInternalUserId: '7',
        validFrom: AHORA,
        expiresAt: null,
      }),
      expect.anything(),
    );
    const registro = audit.create.mock.calls[0]![0];
    expect(registro).toMatchObject({
      actionCode: CARD_TIER_OVERRIDE_SET,
      targetType: 'customer',
      targetId: '42',
      actorInternalUserId: '7',
    });
    expect((registro.payloadJson as Record<string, unknown>).tierCode).toBe('GOLD');
  });

  it('un ajuste vigente previo se REVOCA antes de crear el nuevo: nunca hay dos mandando', async () => {
    const previo = fila({ tierCode: 'SILVER' });
    const { service, overrides } = armar({ abiertos: [previo] });
    await service.setOverride({
      tenantId: '1',
      customerId: '42',
      tierCode: 'GOLD',
      reason: 'Ascenso por revisión comercial',
      expiresAt: null,
      actor: ACTOR,
      now: AHORA,
    });

    expect(previo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        revokedAt: AHORA,
        revokedByInternalUserId: '7',
        revokeReason: expect.stringContaining('Reemplazado por un ajuste nuevo a GOLD'),
      }),
      expect.anything(),
    );
    expect(overrides.create).toHaveBeenCalledTimes(1);
  });

  it('uno vencido sin revocar también se cierra, y dice que venció', async () => {
    const vencido = fila({ expiresAt: new Date('2026-09-20T00:00:00Z') });
    const { service } = armar({ abiertos: [vencido] });
    await service.setOverride({
      tenantId: '1',
      customerId: '42',
      tierCode: 'SILVER',
      reason: 'Nuevo ajuste tras el vencimiento',
      expiresAt: null,
      actor: ACTOR,
      now: AHORA,
    });

    expect(vencido.update).toHaveBeenCalledWith(
      expect.objectContaining({ revokeReason: expect.stringContaining('Venció el 2026-09-20') }),
      expect.anything(),
    );
  });

  it('el vencimiento debe ser futuro', async () => {
    const { service, overrides } = armar();
    await expect(
      service.setOverride({
        tenantId: '1',
        customerId: '42',
        tierCode: 'GOLD',
        reason: 'Motivo suficientemente largo',
        expiresAt: new Date('2026-10-01T00:00:00Z'),
        actor: ACTOR,
        now: AHORA,
      }),
    ).rejects.toMatchObject({ response: { code: 'CARD_TIER_EXPIRY_IN_PAST' } });
    expect(overrides.create).not.toHaveBeenCalled();
  });

  it('una tarjeta que no existe en el catálogo se rechaza sin tocar nada', async () => {
    const sinGold = DEFAULT_CARD_TIERS.filter((t) => t.code !== 'GOLD');
    const { service, overrides } = armar({
      catalogoDelTenant: sinGold.map((t) => ({ ...t, tierCode: t.code, levelCode: t.levelCode, benefitsJson: [], themeJson: t.theme })),
    });
    // Con el catálogo del tenant incompleto se usa el de fábrica (que sí trae GOLD): se prueba con un código imposible.
    await expect(
      service.setOverride({
        tenantId: '1',
        customerId: '42',
        tierCode: 'DIAMANTE' as never,
        reason: 'Motivo suficientemente largo',
        expiresAt: null,
        actor: ACTOR,
        now: AHORA,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(overrides.create).not.toHaveBeenCalled();
  });

  it('si la auditoría falla, el error sube y la transacción lo deshace (no se traga)', async () => {
    const { service, audit } = armar();
    audit.create.mockRejectedValueOnce(new Error('auditoría caída'));
    await expect(
      service.setOverride({
        tenantId: '1',
        customerId: '42',
        tierCode: 'GOLD',
        reason: 'Motivo suficientemente largo',
        expiresAt: null,
        actor: ACTOR,
        now: AHORA,
      }),
    ).rejects.toThrow('auditoría caída');
  });
});

describe('revokeOverride', () => {
  it('revoca el ajuste con su motivo, quién y la auditoría', async () => {
    const ajuste = fila();
    const { service, audit } = armar({ abiertos: [ajuste] });
    await service.revokeOverride({
      tenantId: '1',
      customerId: '42',
      reason: 'Se corrige tras revisar el expediente',
      actor: ACTOR,
      now: AHORA,
    });

    expect(ajuste.update).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: AHORA, revokedByInternalUserId: '7', revokeReason: 'Se corrige tras revisar el expediente' }),
      expect.anything(),
    );
    expect(audit.create.mock.calls[0]![0]).toMatchObject({ actionCode: CARD_TIER_OVERRIDE_REVOKED, targetId: '42' });
  });

  it('sin ajuste que revocar es un 404 claro, no un éxito vacío', async () => {
    const { service, audit } = armar({ abiertos: [] });
    await expect(
      service.revokeOverride({ tenantId: '1', customerId: '42', reason: 'No hay nada que revocar aquí', actor: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.create).not.toHaveBeenCalled();
  });
});

describe('actorOf', () => {
  it('un usuario interno se registra como interno', () => {
    expect(actorOf({ sub: 'x', role: 'admin', internalUserId: '7' } as never)).toEqual({
      actorType: 'internal_user',
      internalUserId: '7',
      platformUserId: null,
    });
  });
  it('un usuario de plataforma se registra como de plataforma', () => {
    expect(actorOf({ sub: 'x', role: 'platform_admin', platformUserId: '3' } as never)).toEqual({
      actorType: 'platform_user',
      internalUserId: null,
      platformUserId: '3',
    });
  });
});
