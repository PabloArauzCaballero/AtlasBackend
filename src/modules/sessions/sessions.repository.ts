import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindAndCountOptions, FindOptions, Op, Transaction } from 'sequelize';
import {
  CustomerDeviceLinkModel,
  CustomerSessionModel,
  DeviceModel,
  DeviceSnapshotModel,
  GlobalDeviceFingerprintModel,
} from '../../database/models/index.js';
import { toOffset } from '../../common/utils/pagination/pagination.util.js';

type RepositoryOptions = {
  transaction?: Transaction;
};

@Injectable()
export class SessionsRepository {
  constructor(
    @InjectModel(GlobalDeviceFingerprintModel) private readonly globalDeviceModel: typeof GlobalDeviceFingerprintModel,
    @InjectModel(DeviceModel) private readonly deviceModel: typeof DeviceModel,
    @InjectModel(CustomerDeviceLinkModel) private readonly customerDeviceLinkModel: typeof CustomerDeviceLinkModel,
    @InjectModel(CustomerSessionModel) private readonly customerSessionModel: typeof CustomerSessionModel,
    @InjectModel(DeviceSnapshotModel) private readonly deviceSnapshotModel: typeof DeviceSnapshotModel,
  ) {}

  findGlobalDevice(deviceFingerprint: string, fingerprintVersion: string, options: RepositoryOptions): Promise<GlobalDeviceFingerprintModel | null> {
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

  findDevice(tenantId: string, deviceFingerprint: string, fingerprintVersion: string, options: RepositoryOptions): Promise<DeviceModel | null> {
    return this.deviceModel.findOne({
      where: { tenantId, deviceFingerprint, fingerprintVersion, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  createDevice(values: {
    tenantId: string;
    globalDeviceFingerprintId: string;
    deviceFingerprint: string;
    fingerprintVersion: string;
    now: Date;
  }, options: RepositoryOptions): Promise<DeviceModel> {
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

  createSession(values: {
    tenantId: string;
    customerId: string;
    deviceId: string;
    sessionTokenHash: string;
    channel: string;
    authMethod: string;
    ipAddress: string | null;
    userAgent: string | null;
    gpsLat: string | null;
    gpsLng: string | null;
    gpsAccuracyMeters: string | null;
    now: Date;
  }, options: RepositoryOptions): Promise<CustomerSessionModel> {
    return this.customerSessionModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        sessionTokenHash: values.sessionTokenHash,
        channel: values.channel,
        authMethod: values.authMethod,
        startedAt: values.now,
        endedAt: null,
        ipAddress: values.ipAddress,
        userAgent: values.userAgent,
        gpsLat: values.gpsLat,
        gpsLng: values.gpsLng,
        gpsAccuracyMeters: values.gpsAccuracyMeters,
        sessionStatus: 'active',
        createdAtValue: values.now,
      },
      { transaction: options.transaction },
    );
  }

  createDeviceSnapshot(values: {
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
  }, options: RepositoryOptions) {
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

  findCustomerSessions(input: { tenantId: string; customerId: string; page: number; limit: number }) {
    return this.customerSessionModel.findAndCountAll({
      where: { tenantId: input.tenantId, customerId: input.customerId },
      order: [['startedAt', 'DESC'], ['id', 'DESC']],
      limit: input.limit,
      offset: toOffset({ page: input.page, limit: input.limit }),
    } as FindAndCountOptions);
  }
}
