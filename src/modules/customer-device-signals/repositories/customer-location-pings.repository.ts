/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza guarda el rastro de posiciones que el cliente autorizó, para contrastar domicilio y detectar fraude.
 * @system inserta el lote ignorando repetidos y resuelve la coordenada del domicilio declarado.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  AddressGpsObservationModel,
  CustomerLocationPingModel,
} from '../../../database/models/index.js';

export type PingRow = {
  tenantId: string;
  customerId: string;
  deviceId: string | null;
  sessionId: string | null;
  consentId: string | null;
  gpsLat: string;
  gpsLng: string;
  gpsAccuracyMeters: string | null;
  altitudeMeters: string | null;
  speedMps: string | null;
  headingDegrees: string | null;
  captureMode: string;
  isMocked: boolean;
  batteryLevel: string | null;
  distanceToDeclaredMeters: string | null;
  capturedAt: Date;
  receivedAt: Date;
};

@Injectable()
export class CustomerLocationPingsRepository {
  constructor(
    @InjectModel(CustomerLocationPingModel)
    private readonly pingModel: typeof CustomerLocationPingModel,
    @InjectModel(AddressGpsObservationModel)
    private readonly gpsModel: typeof AddressGpsObservationModel,
  ) {}

  /**
   * Inserta el lote entero e ignora lo que ya estaba.
   *
   * `ignoreDuplicates` traduce a `ON CONFLICT DO NOTHING`, que es exactamente lo que hace falta: el
   * teléfono acumula posiciones sin cobertura y reenvía el lote al recuperarla, a veces dos veces.
   * Sin esto, el reintento reventaría contra el índice único y perdería también las posiciones
   * nuevas que venían en el mismo lote.
   */
  async bulkInsertIgnoringDuplicates(
    rows: readonly PingRow[],
    options: { transaction?: Transaction } = {},
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const created = await this.pingModel.bulkCreate(
      rows.map((row) => ({ ...row, createdAtValue: row.receivedAt })),
      { ignoreDuplicates: true, transaction: options.transaction },
    );
    // Con `ignoreDuplicates`, PostgreSQL no devuelve `_id` para las filas descartadas: las que
    // traen id son las que entraron de verdad.
    return created.filter((row) => row.id !== null && row.id !== undefined).length;
  }

  /**
   * La coordenada del domicilio declarado, si existe.
   *
   * La más reciente con latitud y longitud: una observación sin coordenada es una dirección tecleada
   * sin GPS, y tomarla como referencia daría una distancia calculada contra la nada.
   */
  findLatestDeclaredCoordinate(tenantId: string, customerId: string): Promise<AddressGpsObservationModel | null> {
    return this.gpsModel.findOne({
      where: {
        tenantId,
        customerId,
        gpsLat: { [Op.ne]: null },
        gpsLng: { [Op.ne]: null },
      },
      order: [['_id', 'DESC']],
    });
  }

  countFor(tenantId: string, customerId: string): Promise<number> {
    return this.pingModel.count({ where: { tenantId, customerId } });
  }
}
