import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import {
  CustomerDeviceLinkModel,
  DeviceModel,
  DeviceRiskEventModel,
  DeviceSnapshotModel,
  GlobalDeviceFingerprintModel,
} from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: extraído de `sessions.repository.ts` (era un único repositorio de 857 líneas
 * con 18 modelos inyectados). Este repositorio concentra únicamente la responsabilidad de
 * huella/reputación de dispositivo: fingerprint global, dispositivo por tenant, vínculo
 * cliente-dispositivo y eventos de riesgo de dispositivo. Ningún método cambió de firma ni de
 * comportamiento respecto al original — es un split mecánico, no una reescritura de lógica.
 */
@Injectable()
export class SessionsDeviceRepository {
  constructor(
    @InjectModel(GlobalDeviceFingerprintModel) private readonly globalDeviceModel: typeof GlobalDeviceFingerprintModel,
    @InjectModel(DeviceModel) private readonly deviceModel: typeof DeviceModel,
    @InjectModel(CustomerDeviceLinkModel) private readonly customerDeviceLinkModel: typeof CustomerDeviceLinkModel,
    @InjectModel(DeviceSnapshotModel) private readonly deviceSnapshotModel: typeof DeviceSnapshotModel,
    @InjectModel(DeviceRiskEventModel) private readonly deviceRiskEventModel: typeof DeviceRiskEventModel,
  ) {}

  findGlobalDevice(
    deviceFingerprint: string,
    fingerprintVersion: string,
    options: RepositoryOptions,
  ): Promise<GlobalDeviceFingerprintModel | null> {
    return this.globalDeviceModel.findOne({
      where: { deviceFingerprint, fingerprintVersion },
      transaction: options.transaction,
    } as FindOptions);
  }

  createGlobalDevice(values: { deviceFingerprint: string; fingerprintVersion: string; now: Date }, options: RepositoryOptions) {
    return this.globalDeviceModel.create(
      {
        deviceFingerprint: values.deviceFingerprint,
        fingerprintVersion: values.fingerprintVersion,
        globalFirstSeenAt: values.now,
        globalLastSeenAt: values.now,
        globalReuseCount: 1,
        globalRiskStatus: 'unknown',
        createdAtValue: values.now,
        updatedAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  async touchGlobalDevice(globalDevice: GlobalDeviceFingerprintModel, now: Date, options: RepositoryOptions): Promise<void> {
    globalDevice.globalLastSeenAt = now;
    globalDevice.globalReuseCount = (globalDevice.globalReuseCount ?? 0) + 1;
    globalDevice.updatedAtValue = now;
    await globalDevice.save({ transaction: options.transaction });
  }

  findDevice(
    tenantId: string,
    deviceFingerprint: string,
    fingerprintVersion: string,
    options: RepositoryOptions,
  ): Promise<DeviceModel | null> {
    return this.deviceModel.findOne({
      where: { tenantId, deviceFingerprint, fingerprintVersion, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  findDeviceById(tenantId: string, deviceId: string, options: RepositoryOptions = {}): Promise<DeviceModel | null> {
    return this.deviceModel.findOne({
      where: { tenantId, id: deviceId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  createDevice(
    values: {
      tenantId: string;
      globalDeviceFingerprintId: string;
      deviceFingerprint: string;
      fingerprintVersion: string;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<DeviceModel> {
    return this.deviceModel.create(
      {
        tenantId: values.tenantId,
        globalDeviceFingerprintId: values.globalDeviceFingerprintId,
        deviceFingerprint: values.deviceFingerprint,
        fingerprintVersion: values.fingerprintVersion,
        firstSeenAt: values.now,
        lastSeenAt: values.now,
        tenantReuseCount: 1,
        riskStatus: 'unknown',
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  async touchDevice(device: DeviceModel, now: Date, options: RepositoryOptions): Promise<void> {
    device.lastSeenAt = now;
    device.tenantReuseCount = (device.tenantReuseCount ?? 0) + 1;
    device.updatedAtValue = now;
    await device.save({ transaction: options.transaction });
  }

  findCustomerDeviceLink(tenantId: string, customerId: string, deviceId: string, options: RepositoryOptions) {
    return this.customerDeviceLinkModel.findOne({
      where: { tenantId, customerId, deviceId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  createCustomerDeviceLink(values: { tenantId: string; customerId: string; deviceId: string; now: Date }, options: RepositoryOptions) {
    return this.customerDeviceLinkModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        linkStatus: 'active',
        isPrimaryDevice: false,
        trustLevel: 'new',
        firstSeenSessionId: null,
        lastSeenSessionId: null,
        firstSeenAt: values.now,
        lastSeenAt: values.now,
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  async touchCustomerDeviceLink(link: CustomerDeviceLinkModel, sessionId: string, now: Date, options: RepositoryOptions): Promise<void> {
    link.lastSeenSessionId = sessionId;
    if (link.firstSeenSessionId === null) {
      link.firstSeenSessionId = sessionId;
    }
    link.lastSeenAt = now;
    link.updatedAtValue = now;
    await link.save({ transaction: options.transaction });
  }

  createDeviceSnapshot(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      sessionId: string;
      brand: string | null;
      model: string | null;
      osFamily: string | null;
      osVersion: string | null;
      appVersion: string | null;
      isRooted: boolean | null;
      isEmulator: boolean | null;
      vpnDetected: boolean | null;
      now: Date;
    },
    options: RepositoryOptions,
  ) {
    return this.deviceSnapshotModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        sessionId: values.sessionId,
        brand: values.brand,
        model: values.model,
        osFamily: values.osFamily,
        osVersion: values.osVersion,
        appVersion: values.appVersion,
        isRooted: values.isRooted,
        isEmulator: values.isEmulator,
        vpnDetected: values.vpnDetected,
        capturedAt: values.now,
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  findLatestDeviceSnapshot(tenantId: string, sessionId: string): Promise<DeviceSnapshotModel | null> {
    return this.deviceSnapshotModel.findOne({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  findSessionDeviceSnapshots(tenantId: string, sessionId: string, limit = 10): Promise<DeviceSnapshotModel[]> {
    return this.deviceSnapshotModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  createDeviceRiskEvent(
    values: {
      tenantId: string;
      deviceId: string;
      eventType: string;
      reasonCode: string;
      evidence: Record<string, unknown>;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<DeviceRiskEventModel> {
    return this.deviceRiskEventModel.create(
      {
        tenantId: values.tenantId,
        deviceId: values.deviceId,
        eventType: values.eventType,
        previousRiskStatus: null,
        newRiskStatus: null,
        reasonCode: values.reasonCode,
        supportingEvidenceJson: values.evidence,
        happenedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  findDeviceRiskEvents(tenantId: string, deviceId: string, limit = 20): Promise<DeviceRiskEventModel[]> {
    return this.deviceRiskEventModel.findAll({
      where: { tenantId, deviceId },
      order: [
        ['happenedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }
}
