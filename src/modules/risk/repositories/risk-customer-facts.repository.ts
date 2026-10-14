/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Lee lo que el cliente declaró y posee (consentimientos, contactos, documentos, dispositivos) sin escribir nada.
 * @system entrega los hechos de entrada de la evaluación y comprueba que dispositivo y sesión sean del cliente evaluado.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import {
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerDeviceLinkModel,
  CustomerIdentityDocumentModel,
  CustomerSessionModel,
} from '../../../database/models/index.js';

@Injectable()
export class RiskCustomerFactsRepository {
  constructor(
    @InjectModel(CustomerConsentModel) private readonly consentModel: typeof CustomerConsentModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactMethodModel: typeof CustomerContactMethodModel,
    @InjectModel(CustomerIdentityDocumentModel) private readonly identityDocumentModel: typeof CustomerIdentityDocumentModel,
    @InjectModel(CustomerSessionModel) private readonly sessionModel: typeof CustomerSessionModel,
    @InjectModel(CustomerDeviceLinkModel) private readonly deviceLinkModel: typeof CustomerDeviceLinkModel,
  ) {}

  /**
   * Cuáles de las referencias que mandó quien pide la evaluación son DEL cliente evaluado. Un
   * dispositivo es suyo si tiene vínculo con él o si una sesión suya lo usó; una sesión, si es suya.
   */
  async findOwnedDeviceReferences(
    tenantId: string,
    customerId: string,
    refs: { deviceId?: string | null; sessionId?: string | null },
  ): Promise<{ deviceOwned: boolean; sessionOwned: boolean }> {
    const deviceOwned = refs.deviceId
      ? (await this.deviceLinkModel.count({ where: { tenantId, customerId, deviceId: refs.deviceId } } as FindOptions)) > 0 ||
        (await this.sessionModel.count({ where: { tenantId, customerId, deviceId: refs.deviceId } } as FindOptions)) > 0
      : true;
    const sessionOwned = refs.sessionId
      ? (await this.sessionModel.count({ where: { tenantId, customerId, id: refs.sessionId } } as FindOptions)) > 0
      : true;
    return { deviceOwned, sessionOwned };
  }

  findCustomerConsents(tenantId: string, customerId: string): Promise<CustomerConsentModel[]> {
    return this.consentModel.findAll({ where: { tenantId, customerId, granted: true } } as FindOptions);
  }

  findCustomerContacts(tenantId: string, customerId: string): Promise<CustomerContactMethodModel[]> {
    return this.contactMethodModel.findAll({ where: { tenantId, customerId } } as FindOptions);
  }

  findIdentityDocuments(tenantId: string, customerId: string): Promise<CustomerIdentityDocumentModel[]> {
    return this.identityDocumentModel.findAll({ where: { tenantId, customerId } } as FindOptions);
  }
}
