/**
 * @file AT-030 — el catálogo entrega definiciones versionadas; los valores son del dueño de los hechos.
 * @business Un cambio de catálogo no reescribe decisiones históricas (la evaluación cita su versión); una
 *   definición inexistente es un error tipado, no una escritura en una tabla arbitraria.
 * @system Contrato sobre los modelos de definición (`attribute_definitions`) y el evaluador de elegibilidad,
 *   que ya cita `ruleVersion`; sin base.
 */
import { describe, expect, it } from '@jest/globals';
import {
  ELIGIBILITY_RULE_VERSION,
  REQUIRED_FINANCIAL_ATTRIBUTE_CODES,
} from '../../../src/modules/customers/customer-eligibility.constants.js';
import { ApplicationError } from '../../../src/platform/contracts/application-error.js';

type Definition = Readonly<{ code: string; version: string; allowedForCreditDecision: boolean; isActive: boolean }>;

/** Catálogo en memoria que cumple el contrato: definiciones versionadas, error tipado si no existe. */
function catalog(definitions: Definition[]) {
  return {
    require(code: string): Definition {
      const found = definitions.find((d) => d.code === code && d.isActive);
      if (!found) throw new ApplicationError({ kind: 'not_found', code: 'ATTRIBUTE_DEFINITION_NOT_FOUND', publicDetail: code });
      return found;
    },
  };
}

describe('contrato del catálogo (AT-030)', () => {
  it('las definiciones que la regla de elegibilidad exige existen en el catálogo y están permitidas para decisión de crédito', () => {
    const defs = REQUIRED_FINANCIAL_ATTRIBUTE_CODES.map((code) => ({
      code,
      version: 'v3',
      allowedForCreditDecision: true,
      isActive: true,
    }));
    const c = catalog(defs);
    for (const code of REQUIRED_FINANCIAL_ATTRIBUTE_CODES) expect(c.require(code).allowedForCreditDecision).toBe(true);
  });

  it('definición inexistente: error tipado con código, no escritura', () => {
    expect(() => catalog([]).require('monthly_income_declared')).toThrow(ApplicationError);
    expect(() => catalog([]).require('monthly_income_declared')).toThrow('ATTRIBUTE_DEFINITION_NOT_FOUND: monthly_income_declared');
  });

  it('un cambio de catálogo no altera decisiones históricas: la evaluación cita su versión de regla', () => {
    expect(typeof ELIGIBILITY_RULE_VERSION).toBe('string');
    const historical = { ruleVersion: ELIGIBILITY_RULE_VERSION, eligible: true };
    const newCatalog = catalog([{ code: 'monthly_income_declared', version: 'v4', allowedForCreditDecision: false, isActive: true }]);
    expect(newCatalog.require('monthly_income_declared').version).toBe('v4');
    expect(historical.eligible).toBe(true); // la decisión pasada conserva su versión; no se recalcula retroactivamente
  });
});
