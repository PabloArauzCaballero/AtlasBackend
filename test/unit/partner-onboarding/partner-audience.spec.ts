import { describe, expect, it } from '@jest/globals';
import { networkBand, projectPartnerAudience } from '../../../src/modules/partner-onboarding/application/partner-audience.js';

/**
 * Los rasgos con los que se segmenta a un comercio, derivados de su expediente.
 *
 * Lo que se fija aquí es que el segmento describa al comercio y no a lo que el comercio dice de sí
 * mismo: todo sale de lo que ya está guardado, y lo que no está guardado queda ausente en vez de
 * rellenarse — un valor por defecto metería al comercio en segmentos que nadie comprobó.
 */

type AnyRecord = Record<string, unknown>;

const profile = (overrides: AnyRecord = {}) => ({ businessCategory: 'ferreteria', onboardingStatus: 'approved', ...overrides }) as never;

const branch = (city: string | null) => ({ city }) as never;

describe('rasgos de audiencia del partner', () => {
  it('deriva los rasgos del expediente guardado', () => {
    const traits = projectPartnerAudience({
      profile: profile(),
      branches: [branch('Santa Cruz'), branch('Cochabamba'), branch('Santa Cruz')],
      liveQrKinds: ['business', 'bank'],
      posTerminalCount: 4,
    });

    expect(traits).toEqual({
      merchantCategory: 'ferreteria',
      city: 'Santa Cruz',
      cityCount: 2,
      branchCount: 3,
      posTerminalCount: 4,
      verified: true,
      qrPaymentsReady: true,
      networkBand: 'PEQUENA_RED',
    });
  });

  /*
   * `verified` sale del estado del expediente y de ningún otro sitio. Es el rasgo que ninguna otra
   * capa puede dar: la ficha comercial no sabe si alguien revisó los papeles.
   */
  it('un expediente sin aprobar no cuenta como verificado', () => {
    const traits = projectPartnerAudience({
      profile: profile({ onboardingStatus: 'under_review' }),
      branches: [branch('La Paz')],
      liveQrKinds: ['business', 'bank'],
      posTerminalCount: 1,
    });

    expect(traits.verified).toBe(false);
  });

  /*
   * Hacen falta los DOS QR: el del negocio identifica al comercio y el bancario dice a qué cuenta
   * va el dinero. Con medio circuito no se completa una venta, y darlo por listo metería en la
   * campaña a comercios que no pueden cobrar.
   */
  it('con un solo QR no está listo para cobrar', () => {
    const soloNegocio = projectPartnerAudience({
      profile: profile(),
      branches: [branch('La Paz')],
      liveQrKinds: ['business'],
      posTerminalCount: 0,
    });
    const soloBancario = projectPartnerAudience({
      profile: profile(),
      branches: [branch('La Paz')],
      liveQrKinds: ['bank'],
      posTerminalCount: 0,
    });

    expect(soloNegocio.qrPaymentsReady).toBe(false);
    expect(soloBancario.qrPaymentsReady).toBe(false);
  });

  it('lo que el expediente no guarda queda ausente, no relleno', () => {
    const traits = projectPartnerAudience({
      profile: profile({ businessCategory: null }),
      branches: [branch(null)],
      liveQrKinds: [],
      posTerminalCount: 0,
    });

    expect(traits.merchantCategory).toBeUndefined();
    expect(traits.city).toBeUndefined();
    expect(traits.cityCount).toBe(0);
  });

  describe('bandas de red', () => {
    it.each([
      [0, 'UNICO'],
      [1, 'UNICO'],
      [2, 'PEQUENA_RED'],
      [5, 'PEQUENA_RED'],
      [6, 'RED'],
    ])('%i locales caen en %s', (count, band) => {
      expect(networkBand(count)).toBe(band);
    });
  });
});
