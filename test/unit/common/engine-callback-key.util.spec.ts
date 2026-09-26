import { afterEach, describe, expect, it } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { assertEngineCallbackKey } from '../../../src/common/utils/auth/engine-callback-key.util.js';
import { env } from '../../../src/config/env.js';

type Mutable = { ENGINE_CALLBACK_API_KEY?: string };

/**
 * La clave con la que el Motor cierra los circuitos de identidad, riesgo y crédito se compara en
 * tiempo constante. Estas pruebas fijan lo observable: acepta sólo la exacta, y una clave de otra
 * longitud se rechaza con 401 —no con el RangeError de `timingSafeEqual`, que filtraría la longitud—.
 */
describe('assertEngineCallbackKey', () => {
  const original = env.ENGINE_CALLBACK_API_KEY;
  afterEach(() => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = original;
  });

  it('acepta exactamente la clave configurada', () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave-del-motor';
    expect(() => assertEngineCallbackKey('clave-del-motor')).not.toThrow();
  });

  it('rechaza con 401 una clave de otra longitud o que sólo comparte el prefijo', () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave-del-motor';
    for (const intento of ['c', 'clave-del-moto', 'clave-del-motor-y-mas', 'CLAVE-DEL-MOTOR']) {
      expect(() => assertEngineCallbackKey(intento)).toThrow(UnauthorizedException);
    }
  });

  it('sin clave configurada no acepta a nadie', () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = undefined;
    expect(() => assertEngineCallbackKey('cualquiera')).toThrow(UnauthorizedException);
  });
});
