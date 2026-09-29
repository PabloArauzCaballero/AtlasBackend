/**
 * @file Puerto de persistencia: lee lo que el cliente ya contestó en el alta.
 * @business Volver a un paso del alta tiene que enseñar lo que la persona ya escribió, no un formulario vacío.
 * @system sólo lectura sobre la versión vigente del domicilio y su última observación GPS.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { AddressGpsObservationModel, CustomerAddressModel, CustomerAddressVersionModel } from '../../../database/models/index.js';

@Injectable()
export class CustomerOnboardingAnswersRepository {
  constructor(
    @InjectModel(CustomerAddressModel) private readonly addressModel: typeof CustomerAddressModel,
    @InjectModel(CustomerAddressVersionModel) private readonly addressVersionModel: typeof CustomerAddressVersionModel,
    @InjectModel(AddressGpsObservationModel) private readonly gpsModel: typeof AddressGpsObservationModel,
  ) {}

  /** La versión vigente del domicilio de casa, o `null` si todavía no se declaró. */
  async findCurrentHomeAddressVersion(tenantId: string, customerId: string): Promise<CustomerAddressVersionModel | null> {
    const address = await this.addressModel.findOne({
      where: { tenantId, customerId, addressType: 'home', deleted: { [Op.ne]: true } },
      order: [
        ['lastSeenAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
    if (!address?.currentVersionId) return null;
    return this.addressVersionModel.findOne({ where: { tenantId, id: address.currentVersionId } } as FindOptions);
  }

  /** La última coordenada que se guardó con ESA versión del domicilio. */
  findLatestGpsForAddressVersion(tenantId: string, addressVersionId: string): Promise<AddressGpsObservationModel | null> {
    return this.gpsModel.findOne({
      where: { tenantId, addressVersionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }
}
