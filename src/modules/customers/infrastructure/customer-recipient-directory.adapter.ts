/**
 * @file Adaptador de Clientes para el directorio de destinatarios de Mensajería (AT-020).
 * @business Clientes es dueño de los contactos: decide qué contacto está vigente y verificado para un
 *   canal y entrega sólo su identificador; el dato en claro no cruza la frontera.
 * @system Implementa `RecipientDirectoryPort` (contrato de plataforma que Mensajería consume) sobre
 *   `CustomerContactsRepository`. Lo registra la composición de Mensajería con el token del puerto.
 */
import { Injectable } from '@nestjs/common';
import { decryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import type {
  DeliveryAddress,
  DeliveryAddressLookup,
  RecipientDirectoryPort,
  RecipientLookup,
  RecipientResolution,
} from '../../../platform/contracts/recipient-directory.js';
import { CustomerContactsRepository } from '../repositories/customer-contacts.repository.js';

/** Qué tipo de contacto sirve a cada canal. `in_app` y `push` no necesitan contacto: van por el dispositivo. */
const CONTACT_TYPE_BY_CHANNEL: Readonly<Record<string, string | null>> = Object.freeze({
  email: 'email',
  sms: 'phone',
  whatsapp: 'phone',
  phone: 'phone',
  in_app: null,
  push: null,
});

@Injectable()
export class CustomerRecipientDirectoryAdapter implements RecipientDirectoryPort {
  constructor(private readonly contacts: CustomerContactsRepository) {}

  async resolve(lookup: RecipientLookup): Promise<RecipientResolution> {
    const resolvedAt = new Date().toISOString();
    if (lookup.recipient.type !== 'customer') return Object.freeze({ status: 'unsupported', contactId: null, resolvedAt });
    const wanted = CONTACT_TYPE_BY_CHANNEL[lookup.channel];
    if (wanted === undefined) return Object.freeze({ status: 'unsupported', contactId: null, resolvedAt });
    if (wanted === null) return Object.freeze({ status: 'available', contactId: null, resolvedAt });

    const methods = await this.contacts.findContactMethods(lookup.tenantId, lookup.recipient.id);
    const candidates = methods.filter((method) => method.contactType === wanted && !method.deleted);
    const verified = candidates.find((method) => method.status === 'verified');
    if (verified) return Object.freeze({ status: 'available', contactId: String(verified.id), resolvedAt });
    if (candidates.length > 0) return Object.freeze({ status: 'unverified', contactId: String(candidates[0].id), resolvedAt });
    return Object.freeze({ status: 'absent', contactId: null, resolvedAt });
  }

  /** Propósitos que Clientes autoriza a Mensajería. `marketing` exige consentimiento (AT-028) y hoy no se concede aquí. */
  private static readonly ALLOWED_PURPOSES: ReadonlySet<string> = new Set(['transactional', 'otp', 'security']);

  async resolveDeliveryAddresses(lookup: DeliveryAddressLookup): Promise<readonly DeliveryAddress[]> {
    const resolvedAt = new Date().toISOString();
    if (lookup.recipient.type !== 'customer' || !CustomerRecipientDirectoryAdapter.ALLOWED_PURPOSES.has(lookup.purpose)) return [];
    const wanted = CONTACT_TYPE_BY_CHANNEL[lookup.channel];
    if (!wanted) return [];
    const kind: DeliveryAddress['kind'] = lookup.channel === 'email' ? 'email' : lookup.channel === 'whatsapp' ? 'whatsapp' : 'phone';
    const methods = await this.contacts.findContactMethods(lookup.tenantId, lookup.recipient.id);
    const candidates = methods
      .filter((method) => method.contactType === wanted && !method.deleted && (lookup.purpose === 'otp' || method.status === 'verified'))
      .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)));
    const addresses: DeliveryAddress[] = [];
    for (const method of candidates) {
      const raw = method.contactValueEncrypted as string | Buffer | null;
      const encrypted = raw === null ? null : Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
      const address = encrypted ? await decryptSecretEnvelope(encrypted) : null;
      if (address && !addresses.some((entry) => entry.address === address))
        addresses.push(Object.freeze({ contactId: String(method.id), kind, address, resolvedAt }));
    }
    return Object.freeze(addresses);
  }
}
