/**
 * @file Servicio de aplicación: alta y baja de dispositivos push del cliente.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertCustomerAccess } from './notification-access.util.js';
import { NotificationDeviceTokensRepository } from './notification-device-tokens.repository.js';
import { UpsertDeviceTokenDto } from './notifications.schemas.js';
import { mapDeviceToken } from './notifications.mapper.js';

@Injectable()
export class NotificationDeviceTokensService {
  constructor(private readonly deviceTokens: NotificationDeviceTokensRepository) {}

  async upsertDeviceToken(tenantId: string, customerId: string, body: UpsertDeviceTokenDto, currentUser: AuthenticatedUser) {
    // Registrar un teléfono es cosa de su dueño: un interno que pusiera aquí su propio token recibiría los
    // push del cliente. Dar de baja sí lo puede hacer el personal (`deactivateDeviceToken`).
    if (currentUser.role !== 'customer' && currentUser.role !== 'system') throw new ForbiddenException('DEVICE_TOKEN_OWNER_ONLY');
    assertCustomerAccess(currentUser, customerId);
    return mapDeviceToken(await this.deviceTokens.upsertDeviceToken(tenantId, customerId, body));
  }

  async deactivateDeviceToken(tenantId: string, customerId: string, deviceTokenId: string, currentUser: AuthenticatedUser) {
    assertCustomerAccess(currentUser, customerId);
    return mapDeviceToken(await this.deviceTokens.deactivateDeviceToken(tenantId, customerId, deviceTokenId));
  }
}
