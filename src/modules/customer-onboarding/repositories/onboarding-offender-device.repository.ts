/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Para bloquear al teléfono de quien intentó suplantar a alguien hay que saber qué huellas de dispositivo usó su cuenta.
 * @system lectura de `customer_device_links` y `devices`; no escribe nada.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { CustomerDeviceLinkModel, DeviceModel } from '../../../database/models/index.js';

@Injectable()
export class OnboardingOffenderDeviceRepository {
  constructor(
    @InjectModel(CustomerDeviceLinkModel) private readonly linkModel: typeof CustomerDeviceLinkModel,
    @InjectModel(DeviceModel) private readonly deviceModel: typeof DeviceModel,
  ) {}

  /** Las huellas de los dispositivos vinculados a ese cliente (normalmente una: el del alta). */
  async fingerprintsOfCustomer(tenantId: string, customerId: string): Promise<string[]> {
    const links = await this.linkModel.findAll({ attributes: ['deviceId'], where: { tenantId, customerId } });
    const deviceIds = links.map((link) => link.deviceId).filter((id): id is string => id !== null);
    if (deviceIds.length === 0) return [];
    const devices = await this.deviceModel.findAll({ attributes: ['deviceFingerprint'], where: { tenantId, id: { [Op.in]: deviceIds } } });
    return devices.map((device) => device.deviceFingerprint).filter((fingerprint): fingerprint is string => Boolean(fingerprint));
  }
}
