import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_CARD_TIERS,
  effectiveCatalog,
  isOverrideActive,
  resolveCardTier,
  type CardTierCode,
  type CardTierOverride,
} from '../../../src/modules/credit/domain/card-tier.js';
import { RELATIONSHIP_TIERS } from '../../../src/modules/credit/domain/payment-capacity.js';

/**
 * La tarjeta de cada cliente: la gana por su nivel y el personal puede ajustarla a mano, con vigencia. Un ajuste
 * vencido o revocado NO vale, y quitar una tarjeta del catálogo no deja a nadie sin tarjeta.
 */
const AHORA = new Date('2026-10-03T12:00:00Z');
const horas = (n: number) => new Date(AHORA.getTime() + n * 3_600_000);
const ajuste = (tierCode: CardTierCode, extra: Partial<CardTierOverride> = {}): CardTierOverride => ({
  tierCode,
  expiresAt: null,
  revokedAt: null,
  ...extra,
});
const resolver = (
  levelCode: Parameters<typeof resolveCardTier>[0]['levelCode'],
  override: CardTierOverride | null = null,
  catalog = DEFAULT_CARD_TIERS,
) => resolveCardTier({ levelCode, catalog, override, now: AHORA });

describe('el catálogo de fábrica', () => {
  it('son cinco tarjetas, de menor a mayor: Normal, Silver, Gold, Premium, Black', () => {
    expect(DEFAULT_CARD_TIERS.map((t) => t.label)).toEqual(['Normal', 'Silver', 'Gold', 'Premium', 'Black']);
    expect(DEFAULT_CARD_TIERS.map((t) => t.displayOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it('hay exactamente una tarjeta por cada nivel de relación que existe en el cálculo', () => {
    const niveles = RELATIONSHIP_TIERS.map((n) => n.tier).sort();
    expect(DEFAULT_CARD_TIERS.map((t) => t.levelCode).sort()).toEqual(niveles);
  });

  it('cada tarjeta trae un tema con degradado, tinta y acento', () => {
    for (const t of DEFAULT_CARD_TIERS) {
      expect(t.theme.gradient.length).toBeGreaterThanOrEqual(2);
      expect(t.theme.ink).toMatch(/^#[0-9A-F]{6}$/i);
      expect(t.theme.accent).toMatch(/^#[0-9A-F]{6}$/i);
      expect(t.theme.finish.length).toBeGreaterThan(0);
    }
  });

  it('no promete ventajas comerciales que el negocio no definió', () => {
    for (const t of DEFAULT_CARD_TIERS) expect(t.benefits).toEqual([]);
  });
});

describe('resolveCardTier · automática', () => {
  it.each([
    ['NUEVO', 'NORMAL'],
    ['EN_CONSTRUCCION', 'SILVER'],
    ['ESTABLECIDO', 'GOLD'],
    ['CONSOLIDADO', 'PREMIUM'],
    ['PREFERENTE', 'BLACK'],
  ] as const)('el nivel %s tiene la tarjeta %s', (nivel, tarjeta) => {
    const r = resolver(nivel);
    expect(r.tier.code).toBe(tarjeta);
    expect(r.source).toBe('AUTOMATICA');
    expect(r.automaticTier.code).toBe(tarjeta);
  });
});

describe('resolveCardTier · ajuste manual', () => {
  it('un ajuste vigente prevalece, y dice cuál sería la automática', () => {
    const r = resolver('NUEVO', ajuste('GOLD'));
    expect(r.tier.code).toBe('GOLD');
    expect(r.source).toBe('MANUAL');
    expect(r.automaticTier.code).toBe('NORMAL');
  });

  it('puede bajar la tarjeta, no sólo subirla', () => {
    expect(resolver('PREFERENTE', ajuste('SILVER')).tier.code).toBe('SILVER');
  });

  it('un ajuste con vencimiento futuro sigue vigente', () => {
    expect(resolver('NUEVO', ajuste('GOLD', { expiresAt: horas(5) })).source).toBe('MANUAL');
  });

  it('un ajuste vencido NO vale: vuelve a la automática', () => {
    const r = resolver('NUEVO', ajuste('GOLD', { expiresAt: horas(-1) }));
    expect(r.source).toBe('AUTOMATICA');
    expect(r.tier.code).toBe('NORMAL');
  });

  it('un ajuste revocado NO vale', () => {
    const r = resolver('NUEVO', ajuste('GOLD', { revokedAt: horas(-2) }));
    expect(r.source).toBe('AUTOMATICA');
  });

  it('vencer justo ahora ya no es vigente', () => {
    expect(isOverrideActive({ expiresAt: AHORA, revokedAt: null }, AHORA)).toBe(false);
  });

  it('si la tarjeta del ajuste se retiró del catálogo, se ignora el ajuste y NO se deja a nadie sin tarjeta', () => {
    const sinGold = DEFAULT_CARD_TIERS.filter((t) => t.code !== 'GOLD');
    const r = resolver('EN_CONSTRUCCION', ajuste('GOLD'), sinGold);
    expect(r.source).toBe('AUTOMATICA');
    expect(r.tier.code).toBe('SILVER');
  });
});

describe('resolveCardTier · catálogo raro', () => {
  it('un catálogo vacío es un error claro, no una tarjeta inventada', () => {
    expect(() => resolver('NUEVO', null, [])).toThrow(/catálogo de tarjetas está vacío/);
  });

  it('el orden del catálogo no importa: se ordena por displayOrder', () => {
    const al_reves = [...DEFAULT_CARD_TIERS].reverse();
    expect(resolver('ESTABLECIDO', null, al_reves).tier.code).toBe('GOLD');
  });

  it('si el catálogo no tiene la tarjeta del nivel, cae a la primera en vez de romperse', () => {
    const sinPremium = DEFAULT_CARD_TIERS.filter((t) => t.code !== 'PREMIUM');
    expect(resolver('CONSOLIDADO', null, sinPremium).tier.code).toBe('NORMAL');
  });
});

describe('effectiveCatalog', () => {
  it('con las cinco tarjetas de nivel usa el del tenant', () => {
    const delTenant = DEFAULT_CARD_TIERS.map((t) => ({ ...t, label: `${t.label} (propia)` }));
    expect(effectiveCatalog(delTenant)).toBe(delTenant);
  });

  it('si al tenant le falta un nivel, usa el de fábrica completo', () => {
    expect(effectiveCatalog(DEFAULT_CARD_TIERS.slice(0, 3))).toBe(DEFAULT_CARD_TIERS);
    expect(effectiveCatalog([])).toBe(DEFAULT_CARD_TIERS);
  });
});
