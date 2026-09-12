/**
 * @file Directorio de destinatarios del piloto (AT-057): Mensajería fuera del monolito NO lee Clientes.
 * @business El servicio de Mensajería no tiene permiso sobre las tablas de Clientes; hasta que exista el
 *   contrato HTTP con el dueño, un destinatario «cliente» se resuelve como no soportado y la entrega
 *   queda registrada como no realizable, nunca como enviada ni con una dirección inventada.
 * @system Implementa `RecipientDirectoryPort` devolviendo `unsupported`/vacío y dejando constancia. Es
 *   el hueco declarado en `docs/architecture/microservices/pilot-readiness.json` (bloqueo del GO).
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  DeliveryAddress,
  DeliveryAddressLookup,
  RecipientDirectoryPort,
  RecipientLookup,
  RecipientResolution,
} from '../../../../platform/contracts/recipient-directory.js';

@Injectable()
export class RemoteRecipientDirectoryAdapter implements RecipientDirectoryPort {
  private readonly logger = new Logger(RemoteRecipientDirectoryAdapter.name);

  async resolve(lookup: RecipientLookup): Promise<RecipientResolution> {
    this.logger.warn(
      `RECIPIENT_DIRECTORY_REMOTE_PENDING: canal ${lookup.channel}, tipo ${lookup.recipient.type}; sin contrato HTTP con Clientes.`,
    );
    return Object.freeze({ status: 'unsupported', contactId: null, resolvedAt: new Date().toISOString() });
  }

  async resolveDeliveryAddresses(lookup: DeliveryAddressLookup): Promise<readonly DeliveryAddress[]> {
    this.logger.warn(
      `RECIPIENT_DIRECTORY_REMOTE_PENDING: sin direcciones para ${lookup.channel}/${lookup.purpose}; se registra como no entregable.`,
    );
    return [];
  }
}
