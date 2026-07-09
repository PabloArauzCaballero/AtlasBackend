import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import { AddressGpsObservationModel, CustomerAddressModel, CustomerAddressVersionModel } from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

export type CurrentAddressContext = {
  addressId: string | null;
  addressVersionId: string | null;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `sessions.repository.ts`. Responsabilidad única:
 * dirección declarada del cliente y observaciones GPS asociadas a la sesión. Split mecánico,
 * sin cambio de comportamiento.
 */
@Injectable()
export class SessionsLocationRepository {
  constructor(
    @InjectModel(CustomerAddressModel) private readonly customerAddressModel: typeof CustomerAddressModel,
    @InjectModel(CustomerAddressVersionModel) private readonly customerAddressVersionModel: typeof CustomerAddressVersionModel,
    @InjectModel(AddressGpsObservationModel) private readonly addressGpsObservationModel: typeof AddressGpsObservationModel,
  ) {}

  async findCurrentAddressContext(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<CurrentAddressContext> {
    const address = await this.customerAddressModel.findOne({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [
        ['lastSeenAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);

    if (!address) return { addressId: null, addressVersionId: null };

    if (address.currentVersionId) {
      return { addressId: String(address.id), addressVersionId: String(address.currentVersionId) };
    }

    const version = await this.customerAddressVersionModel.findOne({
      where: { tenantId, customerAddressId: String(address.id), validUntil: null },
      order: [
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);

    return { addressId: String(address.id), addressVersionId: version ? String(version.id) : null };
  }

  createGpsObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      customerAddressId: string | null;
      addressVersionId: string | null;
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
        sessionId: values.sessionId,
        customerAddressId: values.customerAddressId,
        addressVersionId: values.addressVersionId,
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

  findLatestGpsObservation(tenantId: string, sessionId: string): Promise<AddressGpsObservationModel | null> {
    return this.addressGpsObservationModel.findOne({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  findSessionGpsObservations(tenantId: string, sessionId: string, limit = 30): Promise<AddressGpsObservationModel[]> {
    return this.addressGpsObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }
}
