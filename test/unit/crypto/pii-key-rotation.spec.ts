import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { decryptSecretEnvelope, encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import { PiiKeyCanaryService } from '../../../src/modules/customers/infrastructure/pii-key-canary.service.js';

/**
 * TEST, 2026-10-06: el correo de un cliente dejó de descifrarse porque la clave maestra cambió, y con
 * él dejó de salir CUALQUIER mensaje (todos leen la dirección con la misma función).
 */
describe('PII cifrada: la clave maestra puede rotar sin perder lo guardado', () => {
  const mutable = env as unknown as Record<string, string>;
  const original = {
    key: mutable.NOTIFICATION_TOKEN_ENCRYPTION_KEY,
    prev: mutable.NOTIFICATION_TOKEN_ENCRYPTION_PREVIOUS_KEYS,
    jwt: mutable.JWT_ACCESS_TOKEN_SECRET,
  };
  const KEY_A = 'a'.repeat(40);
  const KEY_B = 'b'.repeat(40);

  afterEach(() => {
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_KEY = original.key as string;
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_PREVIOUS_KEYS = original.prev as string;
    mutable.JWT_ACCESS_TOKEN_SECRET = original.jwt as string;
    jest.restoreAllMocks();
  });

  async function cifrarConClaveA(): Promise<string> {
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_KEY = KEY_A;
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_PREVIOUS_KEYS = '';
    return encryptSecretEnvelope('sroda@example.com');
  }

  it('tras rotar a otra clave, lo cifrado con la anterior se lee si la anterior está en PREVIOUS_KEYS', async () => {
    const sobre = await cifrarConClaveA();
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_KEY = KEY_B;
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_PREVIOUS_KEYS = `${'x'.repeat(40)}, ${KEY_A}`;
    expect(await decryptSecretEnvelope(sobre)).toBe('sroda@example.com');
  });

  it('lo nuevo se cifra con la clave vigente, no con la anterior', async () => {
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_KEY = KEY_B;
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_PREVIOUS_KEYS = KEY_A;
    const sobre = await encryptSecretEnvelope('nuevo@example.com');
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_PREVIOUS_KEYS = '';
    expect(await decryptSecretEnvelope(sobre)).toBe('nuevo@example.com');
  });

  it('si la clave anterior se perdió del todo, devuelve null (no un texto equivocado)', async () => {
    const sobre = await cifrarConClaveA();
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_KEY = KEY_B;
    mutable.JWT_ACCESS_TOKEN_SECRET = 'j'.repeat(40);
    expect(await decryptSecretEnvelope(sobre)).toBeNull();
  });

  it('la guarda de arranque cuenta los contactos ilegibles y grita en el log', async () => {
    const sobre = await cifrarConClaveA();
    mutable.NOTIFICATION_TOKEN_ENCRYPTION_KEY = KEY_B;
    mutable.JWT_ACCESS_TOKEN_SECRET = 'j'.repeat(40);
    const model = {
      findAll: jest.fn(async () => [
        { id: 2, contactValueEncrypted: sobre },
        { id: 1, contactValueEncrypted: null },
      ]),
    };
    const servicio = new PiiKeyCanaryService(model as never);
    const error = jest
      .spyOn((servicio as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    await servicio.onApplicationBootstrap();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('1 de 1 contactos'));
  });

  it('la guarda no avisa cuando todo se lee, y no tumba el arranque si la base falla', async () => {
    const sobre = await cifrarConClaveA();
    const bien = new PiiKeyCanaryService({ findAll: async () => [{ id: 1, contactValueEncrypted: sobre }] } as never);
    const error = jest
      .spyOn((bien as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    await bien.onApplicationBootstrap();
    expect(error).not.toHaveBeenCalled();
    const caida = new PiiKeyCanaryService({ findAll: async () => Promise.reject(new Error('sin base')) } as never);
    jest.spyOn((caida as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    await expect(caida.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
