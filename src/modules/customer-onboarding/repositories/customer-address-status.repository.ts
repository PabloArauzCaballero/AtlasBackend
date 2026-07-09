import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import {
  AddressGpsObservationModel,
  CustomerAddressModel,
  CustomerAddressVersionModel,
  CustomerModel,
  CustomerObservationModel,
} from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `customer-onboarding.repository.ts`.
 * Responsabilidad única: dirección declarada del cliente (con versionado), observaciones GPS,
 * observaciones genéricas del cliente y transición de estado de ciclo de vida del cliente.
 * Split mecánico, sin cambio de comportamiento.
 */
@Injectable()
export class CustomerAddressStatusRepository {
  constructor(
    @InjectModel(CustomerAddressModel) private readonly customerAddressModel: typeof CustomerAddressModel,
    @InjectModel(CustomerAddressVersionModel) private readonly customerAddressVersionModel: typeof CustomerAddressVersionModel,
    @InjectModel(AddressGpsObservationModel) private readonly addressGpsObservationModel: typeof AddressGpsObservationModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
    @InjectModel(CustomerModel) private readonly customerModel: typeof CustomerModel,
  ) {}

  findCurrentAddress(
    tenantId: string,
    customerId: string,
    addressType: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerAddressModel | null> {
    return this.customerAddressModel.findOne({
      where: { tenantId, customerId, addressType, deleted: { [Op.ne]: true } },
      order: [
        ['lastSeenAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  createAddress(
    values: { tenantId: string; customerId: string; addressType: string; now: Date },
    options: RepositoryOptions,
  ): Promise<CustomerAddressModel> {
    return this.customerAddressModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        addressType: values.addressType,
        status: 'declared',
        currentVersionId: null,
        firstSeenAt: values.now,
        lastSeenAt: values.now,
        createdAtValue: values.now,
        updatedAtValue: values.now,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  async touchAddress(address: CustomerAddressModel, now: Date, options: RepositoryOptions): Promise<CustomerAddressModel> {
    address.lastSeenAt = now;
    address.updatedAtValue = now;
    return address.save({ transaction: options.transaction });
  }

  createAddressVersion(
    values: {
      tenantId: string;
      customerAddressId: string;
      declaredAddressText: string | null;
      normalizedAddressText: string | null;
      zone: string | null;
      city: string;
      department: string;
      countryCode: string;
      sourceType: string;
      validFrom: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerAddressVersionModel> {
    return this.customerAddressVersionModel.create(
      {
        tenantId: values.tenantId,
        customerAddressId: values.customerAddressId,
        declaredAddressText: values.declaredAddressText,
        normalizedAddressText: values.normalizedAddressText,
        declaredZoneName: values.zone,
        city: values.city,
        department: values.department,
        countryCode: values.countryCode,
        geoZoneCodeSnapshot: null,
        geoZoneNameSnapshot: values.zone,
        evidenceId: null,
        sourceType: values.sourceType,
        verificationStatus: 'declared',
        verifiabilityBand: null,
        validFrom: values.validFrom,
        validUntil: null,
        supersedesVersionId: null,
        createdAtValue: values.validFrom,
      },
      { transaction: options.transaction },
    );
  }

  async updateAddressCurrentVersion(
    address: CustomerAddressModel,
    addressVersionId: string,
    now: Date,
    options: RepositoryOptions,
  ): Promise<CustomerAddressModel> {
    address.currentVersionId = addressVersionId;
    address.lastSeenAt = now;
    address.updatedAtValue = now;
    return address.save({ transaction: options.transaction });
  }

  createGpsObservation(
    values: {
      tenantId: string;
      customerId: string;
      customerAddressId: string;
      addressVersionId: string;
      sessionId: string | null;
      gpsLat: string;
      gpsLng: string;
      gpsAccuracyMeters: string | null;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<AddressGpsObservationModel> {
    return this.addressGpsObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        customerAddressId: values.customerAddressId,
        addressVersionId: values.addressVersionId,
        sessionId: values.sessionId,
        gpsLat: values.gpsLat,
        gpsLng: values.gpsLng,
        gpsAccuracyMeters: values.gpsAccuracyMeters,
        matchScoreAgainstDeclaredAddress: null,
        distanceToDeclaredMeters: null,
        capturedAt: values.capturedAt,
        createdAtValue: values.capturedAt,
      },
      { transaction: options.transaction },
    );
  }

  createCustomerObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      observationCode: string;
      valueText: string | null;
      valueNumber: string | null;
      valueBoolean: boolean | null;
      valueJson: Record<string, unknown> | null;
      confidenceScore: string | null;
      observedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerObservationModel> {
    return this.customerObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        observationCode: values.observationCode,
        valueText: values.valueText,
        valueNumber: values.valueNumber,
        valueBoolean: values.valueBoolean,
        valueJson: values.valueJson,
        sourceType: 'api',
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: values.confidenceScore,
        verificationStatus: 'observed',
        capturedAt: values.observedAt,
        validFrom: values.observedAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.observedAt,
      },
      { transaction: options.transaction },
    );
  }

  async updateCustomerStatus(customer: CustomerModel, newStatus: string, now: Date, options: RepositoryOptions): Promise<CustomerModel> {
    customer.lifecycleStatus = newStatus;
    customer.updatedAtValue = now;
    return customer.save({ transaction: options.transaction });
  }
}
