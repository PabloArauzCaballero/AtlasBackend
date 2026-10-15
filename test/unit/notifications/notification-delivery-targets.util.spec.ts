import { describe, expect, it } from '@jest/globals';
import { decryptDeliveryTargets } from '../../../src/modules/notifications/notification-delivery-targets.util.js';
import { encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';

describe('decryptDeliveryTargets', () => {
  it('descifra los targets del mensaje (round-trip)', async () => {
    const encrypted = await encryptSecretEnvelope('a@x.com');
    const targets = await decryptDeliveryTargets([{ kind: 'email', addressEncrypted: encrypted }] as never);
    expect(targets).toEqual([{ kind: 'email', address: 'a@x.com' }]);
  });

  it('descarta destinos sin lista, de kind inválido o con cifrado no-string', async () => {
    expect(await decryptDeliveryTargets(null as never)).toEqual([]);
    expect(
      await decryptDeliveryTargets([
        { kind: 'inventado', addressEncrypted: 'x' },
        { kind: 'email', addressEncrypted: 123 },
      ] as never),
    ).toEqual([]);
  });
});
