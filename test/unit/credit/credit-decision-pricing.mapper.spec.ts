import { describe, expect, it } from '@jest/globals';
import { pricedRateAndTier } from '../../../src/modules/credit/application/credit-decision-pricing.mapper.js';
import type { DecisionResponse } from '../../../src/modules/decision-engine/decision-engine.types.js';

/**
 * @file La frontera de LECTURA de la tasa que el Motor tarificó (Frente 3A, plan
 * `_plan-motor-decisiones-tasa-2026-09-25`, punto 4). Es el reverso exacto de `rate-units.ts`
 * usado en `credit-decision-engine.service.ts` (punto 3): allí se manda `product_base_annual_rate`
 * en tanto por uno; aquí se recibe `annual_percentage_rate`, también en tanto por uno, y se
 * convierte a porcentaje — la única unidad que el libro de préstamos entiende.
 */
function response(output: Record<string, unknown> | null | undefined): DecisionResponse {
  return {
    executionId: '1',
    status: 'COMPLETED',
    outcome: 'APPROVE',
    reasonCodes: [],
    output,
  } as unknown as DecisionResponse;
}

describe('pricedRateAndTier', () => {
  it('PRUEBA DE CONTRATO — 0,18 en tanto por uno se lee como 18 (porcentaje), fijando 18 ↔ 0,18', () => {
    const { pricedRate } = pricedRateAndTier(response({ annual_percentage_rate: 0.18 }));
    expect(pricedRate).toBe('18.0000');
  });

  it('un tramo cualquiera se lee tal cual, junto a su tasa', () => {
    const { pricedRate, pricingTier } = pricedRateAndTier(response({ annual_percentage_rate: 0.145, pricing_tier: 'C' }));
    expect(pricedRate).toBe('14.5000');
    expect(pricingTier).toBe('C');
  });

  it('PRUEBA EN NEGATIVO — sin `annual_percentage_rate`, la tasa es null: no se inventa un 0 %', () => {
    const { pricedRate } = pricedRateAndTier(response({ pricing_tier: 'A' }));
    expect(pricedRate).toBeNull();
  });

  it('PRUEBA EN NEGATIVO — un `annual_percentage_rate` no numérico (texto, null) se lee como null, no como NaN', () => {
    expect(pricedRateAndTier(response({ annual_percentage_rate: 'no-es-un-numero' })).pricedRate).toBeNull();
    expect(pricedRateAndTier(response({ annual_percentage_rate: null })).pricedRate).toBeNull();
  });

  it('sin `pricing_tier`, o con un tipo que no es texto, el tramo es null', () => {
    expect(pricedRateAndTier(response({ annual_percentage_rate: 0.1 })).pricingTier).toBeNull();
    expect(pricedRateAndTier(response({ annual_percentage_rate: 0.1, pricing_tier: 42 })).pricingTier).toBeNull();
  });

  it('una respuesta sin `output` (artefacto anterior a v2, o motor caído) da null en las dos', () => {
    expect(pricedRateAndTier(response(undefined))).toEqual({ pricedRate: null, pricingTier: null });
    expect(pricedRateAndTier(response(null))).toEqual({ pricedRate: null, pricingTier: null });
  });

  it('sin respuesta en absoluto (null) da null en las dos, sin lanzar', () => {
    expect(pricedRateAndTier(null)).toEqual({ pricedRate: null, pricingTier: null });
  });

  it('0 en tanto por uno es una tasa válida (banda A sin prima) y se lee como 0.0000, no como ausente', () => {
    expect(pricedRateAndTier(response({ annual_percentage_rate: 0 })).pricedRate).toBe('0.0000');
  });
});
