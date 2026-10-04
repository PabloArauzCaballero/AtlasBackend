/**
 * @file Verifica que los códigos de un solo uso no se puedan revertir leyendo la base.
 * @business Un código de 6 dígitos guardado como SHA-256 desnudo se recupera probando el millón; con pimienta, no.
 * @system Ejercita `hashOneTimeCode` / `verifyOneTimeCode` con y sin `AUTH_ONE_TIME_CODE_PEPPER` (plan F2.1, H-15).
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { hashOneTimeCode, verifyOneTimeCode } from '../../../src/common/utils/crypto/one-time-code.util.js';

const mutable = env as { AUTH_ONE_TIME_CODE_PEPPER?: string };
const original = mutable.AUTH_ONE_TIME_CODE_PEPPER;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const PIMIENTA = 'una-pimienta-de-prueba-de-mas-de-32-caracteres';

describe('códigos de un solo uso', () => {
  afterEach(() => {
    mutable.AUTH_ONE_TIME_CODE_PEPPER = original;
  });

  it('sin pimienta conserva el formato anterior', () => {
    mutable.AUTH_ONE_TIME_CODE_PEPPER = undefined;
    expect(hashOneTimeCode('123456')).toBe(sha256('123456'));
    expect(verifyOneTimeCode('123456', sha256('123456'))).toBe(true);
    expect(verifyOneTimeCode('654321', sha256('123456'))).toBe(false);
  });

  it('con pimienta, probar el millón contra la huella guardada no encuentra el código', () => {
    mutable.AUTH_ONE_TIME_CODE_PEPPER = PIMIENTA;
    const guardada = hashOneTimeCode('123456');
    expect(guardada).toHaveLength(64);
    expect(guardada).not.toBe(sha256('123456'));
    // Lo que hace quien sólo tiene la tabla: SHA-256 de cada código posible.
    let encontrado: string | null = null;
    for (let n = 0; n < 1_000_000 && encontrado === null; n += 1) {
      const candidato = String(n).padStart(6, '0');
      if (sha256(candidato) === guardada) encontrado = candidato;
    }
    expect(encontrado).toBeNull();
  });

  it('con pimienta verifica el código correcto y rechaza el resto', () => {
    mutable.AUTH_ONE_TIME_CODE_PEPPER = PIMIENTA;
    const guardada = hashOneTimeCode('123456');
    expect(verifyOneTimeCode('123456', guardada)).toBe(true);
    expect(verifyOneTimeCode('123457', guardada)).toBe(false);
  });

  it('un código emitido ANTES de poner la pimienta sigue valiendo hasta caducar', () => {
    const emitidoAntes = sha256('123456');
    mutable.AUTH_ONE_TIME_CODE_PEPPER = PIMIENTA;
    expect(verifyOneTimeCode('123456', emitidoAntes)).toBe(true);
    expect(verifyOneTimeCode('000000', emitidoAntes)).toBe(false);
  });

  it('una huella con otra forma no rompe la comparación', () => {
    expect(verifyOneTimeCode('123456', 'no-es-hex')).toBe(false);
  });
});
