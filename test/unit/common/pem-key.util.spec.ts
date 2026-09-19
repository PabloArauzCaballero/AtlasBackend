import { describe, expect, it } from '@jest/globals';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { normalizePemKey } from '../../../src/common/utils/crypto/pem-key.util.js';

/**
 * La clave de Firebase del entorno de test llegaba con los saltos escapados DOS veces y la normalización
 * anterior la dejaba inválida: cada push a Android habría fallado. Lo que se fija aquí: toda forma
 * habitual de pegar la clave produce una clave que `createPrivateKey` acepta, idéntica a la original.
 */
describe('normalizePemKey', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
  const escapedOnce = pem.replace(/\n/g, '\\n');
  const escapedTwice = pem.replace(/\n/g, '\\\\n');

  it.each([
    ['con saltos reales', pem],
    ['escapada una vez', escapedOnce],
    ['escapada dos veces (el caso medido en test)', escapedTwice],
    ['entre comillas dobles', `"${escapedOnce}"`],
    ['entre comillas simples', `'${escapedTwice}'`],
    ['con finales CRLF', pem.replace(/\n/g, '\r\n')],
    ['con espacios alrededor', `  ${escapedOnce}\n`],
  ])('%s → clave válida e idéntica a la original', (_name, raw) => {
    const normalized = normalizePemKey(raw);
    expect(normalized).toBe(pem);
    expect(() => createPrivateKey(normalized)).not.toThrow();
  });

  it('la forma escapada dos veces era justo la que la normalización anterior dejaba inválida', () => {
    const anterior = (raw: string) => (raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw);
    expect(() => createPrivateKey(anterior(escapedTwice))).toThrow();
    expect(() => createPrivateKey(normalizePemKey(escapedTwice))).not.toThrow();
  });
});
