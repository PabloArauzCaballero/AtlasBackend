/**
 * @file Directorio de destinatarios del lado de Mensajería (AT-039).
 * @business Mensajería obtiene la dirección de entrega de un cliente preguntándole a Clientes por puerto,
 *   con el propósito que la autoriza; no lee la tabla de contactos ni descifra por su cuenta.
 * @system Traduce `DeliveryAddress` (valores del puerto) a `DeliveryTarget` (lo que consumen los canales).
 *   Si el directorio falla, el error se propaga: la entrega queda `failed` y reintentable, nunca se
 *   envía a un dato arbitrario.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DeliveryTarget, NotificationChannel } from '../../notification-types.js';
import { RECIPIENT_DIRECTORY_PORT, type RecipientDirectoryPort } from '../../application/ports/recipient-directory.port.js';

export const TRANSACTIONAL_PURPOSE = 'transactional';

@Injectable()
export class LocalRecipientDirectoryAdapter {
  constructor(@Inject(RECIPIENT_DIRECTORY_PORT) private readonly directory: RecipientDirectoryPort) {}

  async resolveTargets(input: {
    tenantId: string;
    customerId: string;
    channel: NotificationChannel;
    purpose?: string;
  }): Promise<DeliveryTarget[]> {
    if (!['email', 'sms', 'whatsapp'].includes(input.channel)) return [];
    const addresses = await this.directory.resolveDeliveryAddresses({
      tenantId: input.tenantId,
      recipient: { type: 'customer', id: input.customerId },
      channel: input.channel as 'email' | 'sms' | 'whatsapp',
      purpose: input.purpose ?? TRANSACTIONAL_PURPOSE,
    });
    return addresses.map((entry) => ({ kind: entry.kind, address: entry.address }));
  }
}
