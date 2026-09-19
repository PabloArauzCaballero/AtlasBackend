/**
 * @file Puerto de persistencia del snapshot de agenda calculado en el dispositivo.
 * @business Esta pieza mide el arraigo social de quien se da de alta sin llevarse su libreta de direcciones.
 * @system escribe la ejecución y sus métricas agregadas, y resuelve el cruce contra datos ya conocidos.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  CustomerReferenceContactModel,
  OnDeviceComputationRunModel,
  OnDeviceMetricValueModel,
  WatchlistEntryModel,
} from '../../../database/models/index.js';

/**
 * Las tablas que este flujo usa YA EXISTÍAN, y eso no es casualidad.
 *
 * `on_device_computation_runs` lleva desde el esquema inicial una columna
 * `raw_contacts_stored`, que sólo tiene sentido si alguien previó que la agenda
 * se procesara en el teléfono y que hubiera que dejar constancia de que los
 * datos crudos NO se guardaron. El modelo de datos anticipó este flujo; lo que
 * faltaba era el código que lo llenara.
 *
 * Se reutiliza en vez de crear una tabla propia porque una tabla propia habría
 * significado dos sitios donde vive «lo que el dispositivo calculó», y el día que
 * se añada la segunda señal on-device —los SMS, el uso de la app— habría tres.
 */
@Injectable()
export class CustomerContactsSnapshotRepository {
  constructor(
    @InjectModel(OnDeviceComputationRunModel)
    private readonly runModel: typeof OnDeviceComputationRunModel,
    @InjectModel(OnDeviceMetricValueModel)
    private readonly metricModel: typeof OnDeviceMetricValueModel,
    @InjectModel(WatchlistEntryModel)
    private readonly watchlistModel: typeof WatchlistEntryModel,
    @InjectModel(CustomerReferenceContactModel)
    private readonly referenceModel: typeof CustomerReferenceContactModel,
  ) {}

  createRun(
    values: {
      tenantId: string;
      customerId: string;
      onboardingFlowId: string | null;
      sessionId: string | null;
      algorithmVersion: string;
      computedAtDevice: Date;
      receivedAtServer: Date;
      status: string;
      integrityHash: string;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<OnDeviceComputationRunModel> {
    return this.runModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        onboardingFlowId: values.onboardingFlowId,
        sessionId: values.sessionId,
        algorithmCode: 'CONTACTS_ADDRESS_BOOK_SNAPSHOT',
        algorithmVersion: values.algorithmVersion,
        computationStatus: values.status,
        /*
         * Las dos banderas van a `false` SIEMPRE y por construcción, no por
         * configuración.
         *
         * Son el registro de que aquí no se guardó ni un contacto ni un SMS. Que
         * la fila lo afirme importa el día que alguien tenga que demostrarlo
         * —una auditoría, una solicitud de acceso, una consulta del regulador—:
         * la alternativa es revisar el código de la versión que corría entonces.
         */
        rawContactsStored: false,
        rawSmsStored: false,
        integrityHash: values.integrityHash,
        computedAtDevice: values.computedAtDevice,
        receivedAtServer: values.receivedAtServer,
        createdAtValue: values.receivedAtServer,
      },
      { transaction: options.transaction },
    );
  }

  createMetric(
    values: {
      tenantId: string;
      computationRunId: string;
      metricCode: string;
      valueNumber?: number | null;
      valueBoolean?: boolean | null;
      createdAt: Date;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<OnDeviceMetricValueModel> {
    return this.metricModel.create(
      {
        tenantId: values.tenantId,
        computationRunId: values.computationRunId,
        metricCode: values.metricCode,
        valueNumber: values.valueNumber === null || values.valueNumber === undefined ? null : String(values.valueNumber),
        valueBoolean: values.valueBoolean ?? null,
        createdAtValue: values.createdAt,
      },
      { transaction: options.transaction },
    );
  }

  /** La última captura de este cliente, con sus métricas. `null` si nunca hubo. */
  async findLatestRun(tenantId: string, customerId: string): Promise<OnDeviceComputationRunModel | null> {
    return this.runModel.findOne({
      where: {
        tenantId,
        customerId,
        algorithmCode: 'CONTACTS_ADDRESS_BOOK_SNAPSHOT',
        deleted: { [Op.ne]: true },
      },
      order: [['_id', 'DESC']],
    });
  }

  async findMetrics(tenantId: string, computationRunId: string): Promise<OnDeviceMetricValueModel[]> {
    return this.metricModel.findAll({ where: { tenantId, computationRunId } });
  }

  /**
   * Cuántos de estos hashes ya los conocemos, y por qué caminos.
   *
   * Dos fuentes, y las dos son datos PROPIOS: nunca una lista comprada.
   *
   * - `watchlist_entries`, que es donde el equipo de fraude anota lo que ya
   *   decidió sobre un teléfono. Sólo las vigentes: una entrada retirada se
   *   retiró por algo, y seguir contándola convertiría cada revisión en
   *   permanente.
   * - Las referencias declaradas por OTROS expedientes. Que el teléfono de la
   *   referencia de otra persona esté en esta agenda no prueba nada por sí solo
   *   —un barrio pequeño, una familia grande— pero es la firma más visible de un
   *   anillo: varias altas distintas que se avalan entre sí con los mismos
   *   números.
   *
   * Se consulta con `IN` sobre los hashes recibidos, así que el coste es el de un
   * índice y no el de recorrer la tabla. Los hashes NO se escriben en ninguna
   * parte: entran por parámetro y mueren con la consulta.
   */
  async countKnownPhoneHashes(input: {
    tenantId: string;
    customerId: string;
    phoneHashes: readonly string[];
  }): Promise<{ watchlist: number; otherApplicants: number }> {
    if (input.phoneHashes.length === 0) return { watchlist: 0, otherApplicants: 0 };

    const [watchlist, otherApplicants] = await Promise.all([
      this.watchlistModel.count({
        where: {
          tenantId: input.tenantId,
          entityType: { [Op.in]: ['phone', 'msisdn', 'phone_number'] },
          entityHash: { [Op.in]: [...input.phoneHashes] },
          status: { [Op.in]: ['active', 'confirmed'] },
          deleted: { [Op.ne]: true },
        },
      }),
      this.referenceModel.count({
        where: {
          tenantId: input.tenantId,
          customerId: { [Op.ne]: input.customerId },
          phoneHash: { [Op.in]: [...input.phoneHashes] },
          deleted: { [Op.ne]: true },
        },
        distinct: true,
        col: 'phone_hash',
      }),
    ]);

    return { watchlist, otherApplicants };
  }
}
