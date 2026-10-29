import { describe, expect, it } from '@jest/globals';
import { REFERENCIA } from '../../../src/database/seeders/demo/referencia.seed-data.js';
import { FINANCIAL_ATTRIBUTE_CODES } from '../../../src/modules/customers/customer-eligibility.constants.js';

/**
 * BUG-3 del QA 2026-10-28: sobre una base migrada y sembrada con el perfil demo, guardar el perfil
 * financiero respondía 422 `ATTRIBUTE_CATALOG_NOT_SEEDED` porque la semilla no traía
 * `monthly_income_band` ni `income_frequency` (las migraciones los copian de `employment_status`,
 * que en una base sin sembrar todavía no existe). La semilla es idempotente por `attribute_code`.
 */
describe('semilla de referencia · atributos del perfil financiero', () => {
  const bloque = REFERENCIA.bloques.find((b) => b.tabla === 'catalog.attribute_definitions');
  const filas = (bloque?.filas ?? []) as Array<Record<string, unknown>>;
  const porCodigo = new Map(filas.map((f) => [f.attribute_code as string, f]));

  it('es idempotente por attribute_code', () => {
    expect(bloque?.conflicto).toEqual(['attribute_code']);
  });

  it('trae TODOS los atributos que el servicio del perfil financiero exige', () => {
    const faltan = FINANCIAL_ATTRIBUTE_CODES.filter((code) => !porCodigo.has(code));
    expect(faltan).toEqual([]);
  });

  it('banda y frecuencia de ingreso heredan la clasificación de employment_status', () => {
    const base = porCodigo.get('employment_status')!;
    for (const code of ['monthly_income_band', 'income_frequency']) {
      const fila = porCodigo.get(code)!;
      const { attribute_code: _c, attribute_name: _n, ...resto } = fila;
      const { attribute_code: _bc, attribute_name: _bn, ...restoBase } = base;
      expect(resto).toEqual(restoBase);
    }
  });

  it('no repite códigos', () => {
    expect(porCodigo.size).toBe(filas.length);
  });
});
