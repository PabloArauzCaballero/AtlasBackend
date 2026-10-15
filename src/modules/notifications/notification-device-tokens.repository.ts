/**
 * @file Puerto de persistencia: dispositivos push y direcciones de contacto de los destinatarios.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { decryptSecretEnvelope } from '../../common/utils/crypto/envelope-encryption.util.js';
import { CustomerContactMethodModel, DeviceTokenModel } from '../../database/models/index.js';
import { LocalRecipientDirectoryAdapter } from './infrastructure/directory/local-recipient-directory.adapter.js';
import { legacyCustomerContactTargets } from './infrastructure/directory/legacy-contact-targets.js';
import { upsertDeviceTokenRow } from './infrastructure/persistence/device-token-upsert.js';
import { UpsertDeviceTokenDto } from './notifications.schemas.js';
import { DeliveryTarget, NotificationChannel, PushDevice } from './notification-types.js';

@Injectable()
export class NotificationDeviceTokensRepository {
  constructor(
    @InjectModel(DeviceTokenModel) private readonly deviceTokenModel: typeof DeviceTokenModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactMethodModel: typeof CustomerContactMethodModel,
    @Optional() private readonly recipientDirectory?: LocalRecipientDirectoryAdapter,
  ) {}

  upsertDeviceToken(tenantId: string, customerId: string, body: UpsertDeviceTokenDto): Promise<DeviceTokenModel> {
    return upsertDeviceTokenRow(this.deviceTokenModel, tenantId, customerId, body);
  }

  async getCustomerContactTargets(tenantId: string | null, customerId: string, channel: NotificationChannel): Promise<DeliveryTarget[]> {
    if (!tenantId) return [];
    // AT-039: con el directorio presente, las direcciones llegan por el puerto de Clientes; sin él, lectura legada.
    if (this.recipientDirectory) return this.recipientDirectory.resolveTargets({ tenantId, customerId, channel });
    return legacyCustomerContactTargets(this.contactMethodModel, tenantId, customerId, channel);
  }

  /**
   * Los dispositivos activos, CON su plataforma.
   *
   * Antes devolvía sólo los tokens, y esa pérdida hacía imposible entregar a un iPhone: un token de
   * iOS lo emite Apple y hay que mandarlo a APNs, mientras que uno de Android lo emite Firebase. Sin
   * la plataforma, todos acababan en FCM y los de iPhone se rechazaban siempre.
   */
  async getActivePushDevices(tenantId: string | null, customerId: string): Promise<PushDevice[]> {
    if (!tenantId) return [];
    const rows = await this.deviceTokenModel.findAll({ where: { tenantId, customerId, isActive: true } });
    const devices = await Promise.all(
      rows.map(async (row) => ({ token: await decryptSecretEnvelope(row.tokenEncrypted), platform: row.platform })),
    );
    const seen = new Set<string>();
    return devices.filter((device): device is PushDevice => {
      if (!device.token || seen.has(device.token)) return false;
      seen.add(device.token);
      return true;
    });
  }

  async deactivateDeviceToken(tenantId: string, customerId: string, deviceTokenId: string): Promise<DeviceTokenModel> {
    const token = await this.deviceTokenModel.findOne({ where: { tenantId, customerId, id: deviceTokenId } });
    if (!token) throw new NotFoundException('DEVICE_TOKEN_NOT_FOUND');
    token.isActive = false;
    token.updatedAtValue = new Date();
    await token.save();
    return token;
  }
}
