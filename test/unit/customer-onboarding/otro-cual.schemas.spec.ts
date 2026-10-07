import { describe, expect, it } from '@jest/globals';
import {
  financialProfileSchema,
  updateProfileSchema,
} from '../../../src/modules/customer-onboarding/customer-onboarding-profile.schemas.js';
import { FIELD_TO_ATTRIBUTE_CODE } from '../../../src/modules/customer-onboarding/application/customer-financial-profile.service.js';
import { FINANCIAL_ATTRIBUTE_CODES } from '../../../src/modules/customers/customer-eligibility.constants.js';

/** Toda opción «Otro/Otra» exige y guarda el «¿cuál?». */
describe('«Otra actividad» → ¿cuál?', () => {
  it('rubro Z-OTRO con el texto: válido', () => {
    expect(financialProfileSchema.safeParse({ economicActivityCode: 'Z-OTRO', economicActivityOther: 'Apicultura' }).success).toBe(true);
  });

  it('rubro Z-OTRO sin decir cuál: rechazado en el campo economicActivityOther', () => {
    const r = financialProfileSchema.safeParse({ economicActivityCode: 'Z-OTRO' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.'))).toContain('economicActivityOther');
  });

  it('texto de una sola letra o de sólo espacios: rechazado', () => {
    expect(financialProfileSchema.safeParse({ economicActivityCode: 'Z-OTRO', economicActivityOther: '  a ' }).success).toBe(false);
  });

  it('texto con un rubro del catálogo que no es «Otra»: rechazado', () => {
    expect(financialProfileSchema.safeParse({ economicActivityCode: 'G-COMERCIO', economicActivityOther: 'Algo' }).success).toBe(false);
  });

  it('se persiste en su propio atributo, que forma parte del catálogo económico', () => {
    expect(FIELD_TO_ATTRIBUTE_CODE.economicActivityOther).toBe('economic_activity_other');
    expect(FINANCIAL_ATTRIBUTE_CODES).toContain('economic_activity_other');
  });
});

describe('Género «Otro» → ¿cuál?', () => {
  it('other + texto: válido', () => {
    expect(updateProfileSchema.safeParse({ genderDeclared: 'other', genderSelfDescribed: 'No binario' }).success).toBe(true);
  });

  it('texto sin genderDeclared other: rechazado', () => {
    expect(updateProfileSchema.safeParse({ genderDeclared: 'female', genderSelfDescribed: 'No binario' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ genderSelfDescribed: 'No binario' }).success).toBe(false);
  });

  it('texto de más de 60 caracteres: rechazado', () => {
    expect(updateProfileSchema.safeParse({ genderDeclared: 'other', genderSelfDescribed: 'x'.repeat(61) }).success).toBe(false);
  });
});
