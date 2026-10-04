import { describe, expect, it } from '@jest/globals';
import { CARD_TIER_CODES, revokeCardTierOverrideSchema, setCardTierOverrideSchema } from '../../../src/modules/credit/card-tier.schemas.js';
import { DEFAULT_CARD_TIERS } from '../../../src/modules/credit/domain/card-tier.js';

/** Lo que el personal puede mandar al ajustar una tarjeta: siempre con motivo con cuerpo, y nada de campos de más. */
describe('setCardTierOverrideSchema', () => {
  const valido = { tierCode: 'GOLD', reason: 'Cliente fundador de la red de comercios' };

  it('acepta un ajuste con tarjeta y motivo', () => {
    expect(setCardTierOverrideSchema.safeParse(valido).success).toBe(true);
  });

  it('acepta un vencimiento ISO con zona horaria', () => {
    expect(setCardTierOverrideSchema.safeParse({ ...valido, expiresAt: '2026-12-31T23:59:59-04:00' }).success).toBe(true);
    expect(setCardTierOverrideSchema.safeParse({ ...valido, expiresAt: '2026-12-31T23:59:59Z' }).success).toBe(true);
  });

  it.each(['ayer', '2026-12-31', '31/12/2026', ''])('rechaza un vencimiento mal formado «%s»', (expiresAt) => {
    expect(setCardTierOverrideSchema.safeParse({ ...valido, expiresAt }).success).toBe(false);
  });

  it('rechaza un motivo corto o hecho de espacios: un «ok» no se puede auditar', () => {
    expect(setCardTierOverrideSchema.safeParse({ ...valido, reason: 'ok' }).success).toBe(false);
    expect(setCardTierOverrideSchema.safeParse({ ...valido, reason: '          ' }).success).toBe(false);
    expect(setCardTierOverrideSchema.safeParse({ ...valido, reason: 'nueve ch.' }).success).toBe(false);
    expect(setCardTierOverrideSchema.safeParse({ ...valido, reason: 'diez chars!' }).success).toBe(true);
  });

  it('rechaza un motivo de más de 500 caracteres', () => {
    expect(setCardTierOverrideSchema.safeParse({ ...valido, reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rechaza una tarjeta que no existe', () => {
    expect(setCardTierOverrideSchema.safeParse({ ...valido, tierCode: 'DIAMANTE' }).success).toBe(false);
    expect(setCardTierOverrideSchema.safeParse({ ...valido, tierCode: 'gold' }).success).toBe(false);
  });

  it('rechaza campos de más: no se puede colar un límite de crédito en el ajuste', () => {
    expect(setCardTierOverrideSchema.safeParse({ ...valido, approvedLimit: 99999 }).success).toBe(false);
    expect(setCardTierOverrideSchema.safeParse({ ...valido, creditLimitMultiplier: 6 }).success).toBe(false);
  });
});

describe('revokeCardTierOverrideSchema', () => {
  it('exige motivo con cuerpo', () => {
    expect(revokeCardTierOverrideSchema.safeParse({ reason: 'Se corrige tras revisar el caso' }).success).toBe(true);
    expect(revokeCardTierOverrideSchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(revokeCardTierOverrideSchema.safeParse({}).success).toBe(false);
  });
});

describe('CARD_TIER_CODES', () => {
  it('coincide con las tarjetas de fábrica del dominio: un solo vocabulario', () => {
    expect([...CARD_TIER_CODES]).toEqual(DEFAULT_CARD_TIERS.map((t) => t.code));
  });
});
