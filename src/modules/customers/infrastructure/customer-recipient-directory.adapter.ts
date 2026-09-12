/**
 * @file Adaptador de Clientes para el directorio de destinatarios de Mensajería (AT-020).
 * @business Clientes es dueño de los contactos: decide qué contacto está vigente y verificado para un
 *   canal y entrega sólo su identificador; el dato en claro no cruza la frontera.
 * @system Implementa `RecipientDirectoryPort` (contrato de plataforma que Mensajería consume) sobre
 *   `CustomerContactsRepository`. Lo registra la composición de Mensajería con el token del puerto.
 */
import { Injectable } from '@nestjs/common';
import type { RecipientDirectoryPort, RecipientLookup, RecipientResolution } from '../../../platform/contracts/recipient-directory.js';
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
}
