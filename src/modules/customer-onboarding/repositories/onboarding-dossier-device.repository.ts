/**
 * @file Puerto de persistencia: lo que el teléfono dejó guardado de un cliente.
 * @business El analista del caso de identidad tiene que ver todo lo que Atlas guardó del alta, en un solo sitio.
 * @system sólo lectura, acotada por inquilino y cliente: dispositivo y su huella, permisos, consentimientos, pings de ubicación y agenda sincronizada.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  CustomerConsentModel,
  CustomerDeviceContactModel,
  CustomerDeviceLinkModel,
  CustomerLocationPingModel,
  DeviceModel,
  DeviceSnapshotModel,
  PermissionEventModel,
} from '../../../database/models/index.js';

/** Tope de pings que se resumen. Un rastreo de semanas no cabe en un caso; los últimos sí. */
const PINGS_MAXIMOS = 2_000;
const EVENTOS_MAXIMOS = 200;

@Injectable()
export class OnboardingDossierDeviceRepository {
  constructor(
    @InjectModel(CustomerDeviceLinkModel) private readonly deviceLinks: typeof CustomerDeviceLinkModel,
    @InjectModel(DeviceModel) private readonly devices: typeof DeviceModel,
    @InjectModel(DeviceSnapshotModel) private readonly snapshots: typeof DeviceSnapshotModel,
    @InjectModel(PermissionEventModel) private readonly permissions: typeof PermissionEventModel,
    @InjectModel(CustomerConsentModel) private readonly consents: typeof CustomerConsentModel,
    @InjectModel(CustomerLocationPingModel) private readonly pings: typeof CustomerLocationPingModel,
    @InjectModel(CustomerDeviceContactModel) private readonly deviceContacts: typeof CustomerDeviceContactModel,
  ) {}

  /**
   * El dispositivo del alta: el vínculo activo visto más recientemente, su huella y su última foto
   * de características. Y cuántos OTROS clientes del inquilino están vinculados al mismo aparato.
   */
  async findDevice(tenantId: string, customerId: string) {
    const link = await this.deviceLinks.findOne({
      where: { tenantId, customerId, deviceId: { [Op.ne]: null }, deleted: { [Op.ne]: true } },
      order: [
        ['lastSeenAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
    if (!link?.deviceId) return null;
    const [device, snapshot, otros] = await Promise.all([
      this.devices.findOne({ where: { tenantId, id: link.deviceId } } as FindOptions),
      this.snapshots.findOne({ where: { tenantId, deviceId: link.deviceId }, order: [['id', 'DESC']] } as FindOptions),
      this.deviceLinks.count({
        where: { tenantId, deviceId: link.deviceId, customerId: { [Op.ne]: customerId }, deleted: { [Op.ne]: true } },
        distinct: true,
        col: 'customerId',
      } as never),
    ]);
    return { link, device, snapshot, otrosClientes: Number(otros) || 0 };
  }

  findPermissionEvents(tenantId: string, customerId: string): Promise<PermissionEventModel[]> {
    return this.permissions.findAll({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      limit: EVENTOS_MAXIMOS,
    } as FindOptions);
  }

  findConsents(tenantId: string, customerId: string): Promise<CustomerConsentModel[]> {
    return this.consents.findAll({
      where: { tenantId, customerId },
      order: [['id', 'DESC']],
      limit: EVENTOS_MAXIMOS,
    } as FindOptions);
  }

  /** Los últimos pings, devueltos del más viejo al más nuevo. */
  async findPings(tenantId: string, customerId: string): Promise<CustomerLocationPingModel[]> {
    const filas = await this.pings.findAll({
      where: { tenantId, customerId },
      attributes: ['id', 'captureMode', 'isMocked', 'capturedAt', 'gpsLat', 'gpsLng', 'distanceToDeclaredMeters'],
      order: [['capturedAt', 'DESC']],
      limit: PINGS_MAXIMOS,
    } as FindOptions);
    return filas.reverse();
  }

  countSyncedContacts(tenantId: string, customerId: string): Promise<number> {
    return this.deviceContacts.count({ where: { tenantId, customerId, deleted: { [Op.ne]: true } } } as FindOptions);
  }
}
