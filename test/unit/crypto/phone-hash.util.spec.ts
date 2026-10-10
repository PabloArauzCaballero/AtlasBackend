/**
 * @file La huella de un teléfono no se revierte leyendo la base, y se puede rotar sin el número en claro (APP-21).
 * @business Un móvil boliviano tiene ~2·10⁷ valores: su SHA-256 desnudo se recupera probándolos; el HMAC con clave del servidor, no.
 * @system Ejercita `phoneLookupHash`, `phoneLookupHashFromPlain` y `upgradeStoredPhoneHash` con una y con dos versiones de clave.
 */
import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { hashSensitiveText } from '../../../src/common/utils/crypto/hash.util.js';
import {
  currentPhoneHashVersion,
  phoneLookupHash,
  phoneLookupHashFromPlain,
  upgradeStoredPhoneHash,
} from '../../../src/common/utils/crypto/phone-hash.util.js';

const mutable = env as { PHONE_HASH_HMAC_KEYS?: string };
const original = mutable.PHONE_HASH_HMAC_KEYS;
const K1 = 'clave-uno-de-prueba-de-mas-de-treinta-y-dos';
const K2 = 'clave-dos-de-prueba-de-mas-de-treinta-y-dos';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string, value: string) => createHmac('sha256', key).update(value).digest('hex');
const TELEFONO = '+59171234567';

describe('huella de teléfono con clave del servidor', () => {
  afterEach(() => {
    mutable.PHONE_HASH_HMAC_KEYS = original;
  });

  it('es HMAC-SHA256 sobre el SHA-256 normalizado, con la versión delante', () => {
    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1}`;
    const digest = sha256(TELEFONO);
    expect(phoneLookupHash(digest)).toBe(`ph1:${hmac(K1, digest)}`);
    expect(phoneLookupHash(digest)).not.toContain(digest);
  });

  it('desde el número escrito da lo mismo que desde el SHA-256 que manda la app', () => {
    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1}`;
    expect(phoneLookupHashFromPlain(`  ${TELEFONO} `)).toBe(phoneLookupHash(hashSensitiveText(TELEFONO)));
    expect(phoneLookupHash(sha256(TELEFONO).toUpperCase())).toBe(phoneLookupHashFromPlain(TELEFONO));
  });

  it('probar todos los números contra la huella guardada no la encuentra sin la clave', () => {
    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1}`;
    const guardada = phoneLookupHashFromPlain(TELEFONO);
    expect(guardada).not.toBe(sha256(TELEFONO));
    expect(guardada.slice(4)).not.toBe(hmac(K2, sha256(TELEFONO)));
  });

  it('se niega a envolver una huella ya protegida', () => {
    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1}`;
    expect(() => phoneLookupHash(phoneLookupHashFromPlain(TELEFONO))).toThrow(/ya protegida/u);
  });

  it('sin clave no guarda ni busca: nunca vuelve al SHA-256 desnudo', () => {
    mutable.PHONE_HASH_HMAC_KEYS = undefined;
    expect(() => phoneLookupHashFromPlain(TELEFONO)).toThrow(/PHONE_HASH_HMAC_KEYS/u);
  });

  it('con una lista mal formada falla con el motivo', () => {
    mutable.PHONE_HASH_HMAC_KEYS = `2:${K2}`;
    expect(() => phoneLookupHashFromPlain(TELEFONO)).toThrow(/de la 1 a la vigente/u);
  });

  it('convierte un SHA-256 guardado a la versión vigente y deja igual lo ya convertido', () => {
    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1}`;
    const legado = sha256(TELEFONO);
    const convertido = upgradeStoredPhoneHash(legado);
    expect(convertido).toBe(phoneLookupHashFromPlain(TELEFONO));
    expect(upgradeStoredPhoneHash(convertido as string)).toBeNull();
  });

  it('rotar envuelve la versión anterior: sin el número en claro se llega a la misma huella que calcula el código', () => {
    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1}`;
    const v1 = phoneLookupHashFromPlain(TELEFONO);

    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1},2:${K2}`;
    expect(currentPhoneHashVersion()).toBe(2);
    const v2 = phoneLookupHashFromPlain(TELEFONO);
    expect(v2).toBe(`ph2:${hmac(K2, hmac(K1, sha256(TELEFONO)))}`);
    expect(upgradeStoredPhoneHash(v1)).toBe(v2);
    expect(upgradeStoredPhoneHash(sha256(TELEFONO))).toBe(v2);
  });

  it('no baja de versión: una huella más nueva que la variable es un error de configuración', () => {
    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1},2:${K2}`;
    const v2 = phoneLookupHashFromPlain(TELEFONO);
    mutable.PHONE_HASH_HMAC_KEYS = `1:${K1}`;
    expect(() => upgradeStoredPhoneHash(v2)).toThrow(/versión 2/u);
    expect(() => upgradeStoredPhoneHash('ph1:no-es-hex')).toThrow(/no reconocido/u);
  });
});
