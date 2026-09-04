/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza custodia la agenda que el cliente autorizó a compartir, cifrada y atada a su consentimiento.
 * @system inserta o actualiza cada ficha por su identificador de origen, y la borra entera al retirarse el permiso.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  CustomerConsentModel,
  CustomerDeviceContactModel,
  CustomerDeviceLinkModel,
  CustomerSessionModel,
  OnDeviceComputationRunModel,
} from '../../../database/models/index.js';

/** Los valores de una ficha, ya cifrados y hasheados por el servicio. */
export type ContactRow = {
  tenantId: string;
  customerId: string;
  computationRunId: string | null;
  deviceId: string | null;
  sessionId: string | null;
  consentId: string | null;
  contactExternalIdHash: string;
  displayNameEncrypted: string | null;
  givenNameEncrypted: string | null;
  familyNameEncrypted: string | null;
  companyEncrypted: string | null;
  jobTitleEncrypted: string | null;
  phonesEncrypted: string | null;
  emailsEncrypted: string | null;
  addressesEncrypted: string | null;
  displayNameHash: string | null;
  primaryPhoneHash: string | null;
  primaryPhoneLast4: string | null;
  phoneHashes: string[];
  emailHashes: string[];
  phoneCount: number;
  emailCount: number;
  addressCount: number;
  birthday: string | null;
  isFavorite: boolean;
  contactType: string;
  capturedAt: Date;
  receivedAt: Date;
};

@Injectable()
export class CustomerDeviceContactsRepository {
  constructor(
    @InjectModel(CustomerDeviceContactModel)
    private readonly contactModel: typeof CustomerDeviceContactModel,
    @InjectModel(OnDeviceComputationRunModel)
    private readonly runModel: typeof OnDeviceComputationRunModel,
    @InjectModel(CustomerDeviceLinkModel)
    private readonly deviceLinkModel: typeof CustomerDeviceLinkModel,
    @InjectModel(CustomerSessionModel)
    private readonly sessionModel: typeof CustomerSessionModel,
    @InjectModel(CustomerConsentModel)
    private readonly consentModel: typeof CustomerConsentModel,
  ) {}

  findCustomerDeviceLink(tenantId: string, customerId: string, deviceId: string): Promise<CustomerDeviceLinkModel | null> {
    return this.deviceLinkModel.findOne({ where: { tenantId, customerId, deviceId } });
  }

  findCustomerSession(tenantId: string, customerId: string, sessionId: string): Promise<CustomerSessionModel | null> {
    return this.sessionModel.findOne({ where: { tenantId, customerId, id: sessionId } });
  }

  /**
   * El consentimiento vigente para una finalidad, si lo hay.
   *
   * Vigente significa concedido y no retirado: `revoked_at` nulo. Un consentimiento retirado sigue
   * en la tabla —es la prueba de que se concedió alguna vez— pero no ampara una escritura nueva.
   */
  findGrantedConsent(tenantId: string, customerId: string, purposeCode: string): Promise<CustomerConsentModel | null> {
    return this.consentModel.findOne({
      where: { tenantId, customerId, purposeCode, granted: true, revokedAt: { [Op.is]: null } },
      order: [['_id', 'DESC']],
    });
  }

  /**
   * La ejecución que agrupa una sincronización.
   *
   * Se reutiliza `on_device_computation_runs` —la misma tabla que usa el snapshot agregado— con otro
   * `algorithm_code`. Así «lo que el dispositivo calculó o entregó» sigue viviendo en un solo sitio,
   * y `raw_contacts_stored` dice, captura por captura, si esa vez se guardaron fichas o sólo cuentas.
   */
  createRun(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string | null;
      sessionId: string | null;
      consentId: string | null;
      onboardingFlowId: string | null;
      algorithmVersion: string;
      status: string;
      integrityHash: string;
      computedAtDevice: Date;
      receivedAtServer: Date;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<OnDeviceComputationRunModel> {
    return this.runModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        deviceId: values.deviceId,
        sessionId: values.sessionId,
        consentId: values.consentId,
        onboardingFlowId: values.onboardingFlowId,
        algorithmCode: 'CONTACTS_ADDRESS_BOOK_SYNC',
        algorithmVersion: values.algorithmVersion,
        computationStatus: values.status,
        // A diferencia del snapshot agregado, aquí SÍ se guardan fichas. La columna deja de ser una
        // constante y pasa a ser el hecho que distingue una captura de la otra.
        rawContactsStored: true,
        rawSmsStored: false,
        integrityHash: values.integrityHash,
        computedAtDevice: values.computedAtDevice,
        receivedAtServer: values.receivedAtServer,
        createdAtValue: values.receivedAtServer,
      },
      { transaction: options.transaction },
    );
  }

  findByExternalIdHashes(
    tenantId: string,
    customerId: string,
    hashes: readonly string[],
    options: { transaction?: Transaction } = {},
  ): Promise<CustomerDeviceContactModel[]> {
    if (hashes.length === 0) return Promise.resolve([]);
    return this.contactModel.findAll({
      where: {
        tenantId,
        customerId,
        contactExternalIdHash: { [Op.in]: [...hashes] },
        deleted: { [Op.ne]: true },
      },
      transaction: options.transaction,
    });
  }

  create(values: ContactRow, options: { transaction?: Transaction } = {}): Promise<CustomerDeviceContactModel> {
    return this.contactModel.create(
      { ...values, source: 'device_address_book', createdAtValue: values.receivedAt, updatedAtValue: values.receivedAt, deleted: false },
      { transaction: options.transaction },
    );
  }

  /**
   * Reescribe una ficha existente.
   *
   * Se sobrescriben todos los campos y no sólo los que cambiaron: la agenda es un espejo, y una
   * actualización parcial dejaría el teléfono que la persona borró ayer vivo en nuestra copia.
   */
  update(id: string, values: ContactRow, options: { transaction?: Transaction } = {}): Promise<[number]> {
    const { tenantId: _tenantId, customerId: _customerId, contactExternalIdHash: _hash, ...mutable } = values;
    return this.contactModel.update(
      { ...mutable, updatedAtValue: values.receivedAt },
      { where: { id }, transaction: options.transaction },
    );
  }

  countFor(tenantId: string, customerId: string, options: { transaction?: Transaction } = {}): Promise<number> {
    return this.contactModel.count({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    });
  }

  /**
   * Borrado FÍSICO al retirarse el consentimiento.
   *
   * `_deleted = true` no vale aquí. Lo que se le prometió a la persona en el texto del
   * consentimiento es que su agenda se borra, y una fila marcada como borrada sigue conteniendo el
   * nombre y el teléfono de cada uno de sus contactos. La prueba de que la agenda existió queda en
   * `on_device_computation_runs`, que no guarda ni un dato personal.
   */
  deleteAllFor(tenantId: string, customerId: string, options: { transaction?: Transaction } = {}): Promise<number> {
    return this.contactModel.destroy({ where: { tenantId, customerId }, transaction: options.transaction });
  }

  /**
   * Cuántas de estas fichas aparecen en la agenda de OTROS expedientes.
   *
   * Es la consulta que justifica guardar `phone_hashes` en claro: contesta «¿varias solicitudes
   * distintas comparten los mismos números?» sin descifrar ni una ficha. El operador `&&` de
   * PostgreSQL resuelve el solapamiento contra el índice GIN.
   */
  async countPhoneOverlapWithOtherCustomers(input: {
    tenantId: string;
    customerId: string;
    phoneHashes: readonly string[];
  }): Promise<number> {
    if (input.phoneHashes.length === 0) return 0;
    return this.contactModel.count({
      distinct: true,
      col: 'customer_id',
      where: {
        tenantId: input.tenantId,
        customerId: { [Op.ne]: input.customerId },
        deleted: { [Op.ne]: true },
        phoneHashes: { [Op.overlap]: [...input.phoneHashes] },
      },
    });
  }
}
