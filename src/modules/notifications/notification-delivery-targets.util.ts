/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { lastCharacters, sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { decryptSecretEnvelope, encryptSecretEnvelope } from '../../common/utils/crypto/envelope-encryption.util.js';
import { DeliveryTarget, NotificationChannel } from './notification-types.js';

/**
 * Resolución y cifrado de los destinos de entrega de una notificación (correo, teléfono, token push).
 *
 * Vive fuera de `notifications.repository.ts` porque no toca la base: son funciones puras sobre el
 * payload del mensaje más el envelope encryption. Concentrarlas aquí evita que la dirección del
 * destinatario en claro se disperse por el repositorio.
 */
export type StoredDeliveryTarget = {
  kind: DeliveryTarget['kind'];
  addressEncrypted: string;
  addressHash: string;
  last4: string;
};

function payloadString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

// ATLAS-P10-010: envelope encryption (data key propia por valor) en vez de la clave maestra
// única de secret-box.util.ts — ver ATLAS-PEND-106/112. Ambas funciones pasaron a ser async
// porque encryptSecretEnvelope/decryptSecretEnvelope lo son (una data key real por KMS
// requeriría una llamada de red); decryptSecretEnvelope sigue reconociendo el formato legado
// `v1:...` para no romper direcciones/tokens cifrados antes de esta migración.
export async function buildEncryptedDeliveryTargets(
  channel: NotificationChannel,
  payload: Record<string, unknown>,
): Promise<StoredDeliveryTarget[]> {
  const targetSpecs: Partial<Record<NotificationChannel, { kind: DeliveryTarget['kind']; keys: string[] }>> = {
    email: { kind: 'email', keys: ['email', 'toEmail', 'recipientEmail'] },
    sms: { kind: 'phone', keys: ['phone', 'toPhone', 'recipientPhone', 'smsTo'] },
    whatsapp: { kind: 'whatsapp', keys: ['whatsappTo', 'whatsapp', 'phone', 'toPhone', 'recipientPhone'] },
    push: { kind: 'fcm_token', keys: ['fcmToken', 'pushToken', 'deviceToken'] },
  };
  const spec = targetSpecs[channel];
  if (!spec) return [];
  const address = payloadString(payload, spec.keys);
  if (!address) return [];
  return [
    {
      kind: spec.kind,
      addressEncrypted: await encryptSecretEnvelope(address),
      addressHash: sha256Hex(address),
      last4: lastCharacters(address, 4),
    },
  ];
}

export async function decryptDeliveryTargets(value: Array<Record<string, unknown>> | null): Promise<DeliveryTarget[]> {
  if (!value) return [];
  const resolved = await Promise.all(
    value.map(async (item) => {
      const kind = item.kind;
      const encrypted = item.addressEncrypted;
      if ((kind !== 'email' && kind !== 'phone' && kind !== 'fcm_token' && kind !== 'whatsapp') || typeof encrypted !== 'string') return [];
      // TS no conserva el narrowing de `kind` a través del `await` siguiente; se fija el tipo
      // explícitamente aquí, donde el guard de arriba ya lo garantiza en runtime.
      const narrowedKind: DeliveryTarget['kind'] = kind;
      const address = await decryptSecretEnvelope(encrypted);
      return address ? [{ kind: narrowedKind, address }] : [];
    }),
  );
  return resolved.flat();
}

export function encryptedValueToString(value: string | Buffer | null): string | null {
  if (!value) return null;
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}

export function channelContactType(channel: NotificationChannel): { contactType: string; kind: DeliveryTarget['kind'] } | null {
  if (channel === 'email') return { contactType: 'email', kind: 'email' };
  if (channel === 'sms') return { contactType: 'phone', kind: 'phone' };
  if (channel === 'whatsapp') return { contactType: 'phone', kind: 'whatsapp' };
  return null;
}

export function mergeDeliveryTargets(targets: DeliveryTarget[]): DeliveryTarget[] {
  const seen = new Set<string>();
  const merged: DeliveryTarget[] = [];
  for (const target of targets) {
    const key = `${target.kind}:${target.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(target);
  }
  return merged;
}
