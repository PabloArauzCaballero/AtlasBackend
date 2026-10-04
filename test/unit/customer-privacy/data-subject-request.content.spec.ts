import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONTACT_FIELDS,
  CREDIT_FIELDS,
  IDENTITY_FIELDS,
  PIN_STEP_UP_WINDOW_MS,
  RECTIFICATION_FIELDS,
} from '../../../src/modules/customer-privacy/data-subject-request.content.js';

/** El vocabulario de corrección y sus clases. Las clases deciden quién puede aceptar (F1/F2 del plan). */
describe('vocabulario de corrección', () => {
  it('cada clase usa sólo campos que existen', () => {
    for (const clase of [IDENTITY_FIELDS, CREDIT_FIELDS, CONTACT_FIELDS])
      for (const campo of clase) expect(RECTIFICATION_FIELDS).toContain(campo);
  });

  it('las clases no se pisan: un campo es identidad, crédito o contacto, nunca dos', () => {
    const vistos = [...IDENTITY_FIELDS, ...CREDIT_FIELDS, ...CONTACT_FIELDS];
    expect(new Set(vistos).size).toBe(vistos.length);
  });

  it('nombre, apellido, nacimiento y documento son identidad (exigen diligencia debida, DS 4904)', () => {
    expect([...IDENTITY_FIELDS].sort()).toEqual(['birth_date', 'document_number', 'first_name', 'last_name']);
  });

  it('la confirmación de PIN vale 5 minutos', () => expect(PIN_STEP_UP_WINDOW_MS).toBe(300_000));

  it('la migración permite EXACTAMENTE los mismos campos: si divergen, la base rechazaría solicitudes válidas', () => {
    const migracion = readFileSync(
      resolve(__dirname, '../../../src/database/migrations/20261004100000-data-subject-request-content.ts'),
      'utf8',
    );
    const bloque = /const CAMPOS = \[([\s\S]*?)\];/.exec(migracion)?.[1] ?? '';
    const enMigracion = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enMigracion).toEqual([...RECTIFICATION_FIELDS]);
  });
});
