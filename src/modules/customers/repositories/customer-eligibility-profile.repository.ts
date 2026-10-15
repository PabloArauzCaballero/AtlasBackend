/**
 * @file Puerto de persistencia: hechos de cuenta y datos del cliente que alimentan la habilitación.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system lectura sin escrituras: credenciales, contactos verificados, perfil vigente, atributos económicos, domicilio y referencias.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  AttributeDefinitionModel,
  AuthCredentialModel,
  CustomerAddressModel,
  CustomerAttributeValueModel,
  CustomerContactMethodModel,
  CustomerProfileVersionModel,
  CustomerReferenceContactModel,
} from '../../../database/models/index.js';
import type { EligibilityReadOptions } from './customer-eligibility.read-options.js';

@Injectable()
export class CustomerEligibilityProfileRepository {
  constructor(
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactModel: typeof CustomerContactMethodModel,
    @InjectModel(CustomerProfileVersionModel) private readonly profileModel: typeof CustomerProfileVersionModel,
    @InjectModel(CustomerAttributeValueModel) private readonly attributeValueModel: typeof CustomerAttributeValueModel,
    @InjectModel(AttributeDefinitionModel) private readonly attributeDefinitionModel: typeof AttributeDefinitionModel,
    @InjectModel(CustomerAddressModel) private readonly addressModel: typeof CustomerAddressModel,
    @InjectModel(CustomerReferenceContactModel) private readonly referenceModel: typeof CustomerReferenceContactModel,
  ) {}

  async hasCredentials(customerId: string, options: EligibilityReadOptions): Promise<boolean> {
    const count = await this.credentialModel.count({
      where: { actorType: 'customer', actorId: customerId, deleted: false },
      transaction: options.transaction,
    });
    return count > 0;
  }

  countVerifiedContacts(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<number> {
    return this.contactModel.count({
      where: { tenantId, customerId, status: 'verified', deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    });
  }

  findCurrentProfile(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<CustomerProfileVersionModel | null> {
    return this.profileModel.findOne({
      where: { tenantId, customerId, validUntil: null },
      order: [
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  /**
   * Atributos económicos vigentes: qué códigos hay y, para los numéricos, su valor.
   *
   * Devuelve ambas cosas de una sola pasada porque salen de la misma consulta: la completitud
   * (condición C5) mira los códigos y la elegibilidad por producto mira los valores. Separarlas
   * duplicaría el par de consultas sin ganar nada.
   */
  async findFinancialAttributes(
    tenantId: string,
    customerId: string,
    options: EligibilityReadOptions,
  ): Promise<{ codes: string[]; values: Record<string, number>; texts: Record<string, string> }> {
    const rows = await this.attributeValueModel.findAll({
      where: { tenantId, customerId, validUntil: null },
      attributes: ['attributeDefinitionId', 'valueNumber', 'valueText'],
      transaction: options.transaction,
    } as FindOptions);
    const definitionIds = rows.map((row) => String(row.attributeDefinitionId)).filter((id) => id !== 'null');
    if (definitionIds.length === 0) return { codes: [], values: {}, texts: {} };

    const definitions = await this.attributeDefinitionModel.findAll({
      where: { id: { [Op.in]: definitionIds } },
      attributes: ['id', 'attributeCode'],
      transaction: options.transaction,
    } as FindOptions);
    const codeByDefinitionId = new Map(definitions.map((row) => [String(row.id), row.attributeCode]));

    const codes: string[] = [];
    const values: Record<string, number> = {};
    /*
     * El TEXTO hacía falta y no se leía.
     *
     * La habilitación sólo miraba los atributos numéricos, así que una regla que dependiera de un
     * valor de catálogo —`employment_status`, por ejemplo— no tenía de dónde sacarlo. Se lee aquí,
     * en la misma pasada, en vez de añadir otra consulta.
     */
    const texts: Record<string, string> = {};
    for (const row of rows) {
      const code = codeByDefinitionId.get(String(row.attributeDefinitionId));
      if (!code) continue;
      codes.push(code);
      const numeric = row.valueNumber === null ? Number.NaN : Number(row.valueNumber);
      if (Number.isFinite(numeric)) values[code] = numeric;
      if (typeof row.valueText === 'string' && row.valueText.length > 0) texts[code] = row.valueText;
    }
    return { codes, values, texts };
  }

  async hasCurrentAddress(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<boolean> {
    const count = await this.addressModel.count({
      where: { tenantId, customerId, currentVersionId: { [Op.ne]: null }, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    });
    return count > 0;
  }

  countReferenceContacts(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<number> {
    return this.referenceModel.count({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    });
  }
}
