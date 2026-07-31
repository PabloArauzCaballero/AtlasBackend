/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import {
  AttributeDefinitionModel,
  CustomerAttributeValueModel,
  CustomerContactMethodModel,
  CustomerProfileVersionModel,
  CustomerReferenceContactModel,
} from '../../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/**
 * Persistencia del registro progresivo del cliente: perfil personal, atributos económicos y
 * referencias.
 *
 * Estas tres cosas no tenían dónde escribirse. `customer_attribute_values`,
 * `attribute_definitions` y `customer_reference_contacts` estaban migradas desde el inicio del
 * proyecto y sin una sola referencia en `src/modules/`: el modelo de datos existía, el camino de
 * escritura no.
 */
@Injectable()
export class CustomerProfileDataRepository {
  constructor(
    @InjectModel(CustomerProfileVersionModel) private readonly profileModel: typeof CustomerProfileVersionModel,
    @InjectModel(CustomerAttributeValueModel) private readonly attributeValueModel: typeof CustomerAttributeValueModel,
    @InjectModel(AttributeDefinitionModel) private readonly attributeDefinitionModel: typeof AttributeDefinitionModel,
    @InjectModel(CustomerReferenceContactModel) private readonly referenceModel: typeof CustomerReferenceContactModel,
    @InjectModel(CustomerContactMethodModel) private readonly contactMethodModel: typeof CustomerContactMethodModel,
  ) {}

  findCurrentProfile(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<CustomerProfileVersionModel | null> {
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
   * Cierra la versión vigente del perfil. El versionado ya estaba diseñado en el esquema
   * (`valid_from`/`valid_until`/`supersedes_version_id`) pero solo se usaba una vez, en el registro:
   * no había forma de corregir un dato sin perder el anterior.
   */
  async closeProfileVersion(profile: CustomerProfileVersionModel, closedAt: Date, options: RepositoryOptions): Promise<void> {
    profile.validUntil = closedAt;
    await profile.save({ transaction: options.transaction });
  }

  createProfileVersion(
    values: {
      tenantId: string;
      customerId: string;
      firstName: string | null;
      lastName: string | null;
      fullNameNormalized: string | null;
      birthDate: string | null;
      ageAtCapture: number | null;
      genderDeclared: string | null;
      preferredLanguage: string | null;
      marketingOptIn: boolean | null;
      sourceType: string;
      supersedesVersionId: string | null;
      validFrom: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerProfileVersionModel> {
    return this.profileModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        firstName: values.firstName,
        lastName: values.lastName,
        fullNameNormalized: values.fullNameNormalized,
        birthDate: values.birthDate,
        ageAtCapture: values.ageAtCapture,
        genderDeclared: values.genderDeclared,
        preferredLanguage: values.preferredLanguage,
        marketingOptIn: values.marketingOptIn,
        sourceType: values.sourceType,
        validFrom: values.validFrom,
        validUntil: null,
        supersedesVersionId: values.supersedesVersionId,
        createdAtValue: values.validFrom,
      },
      { transaction: options.transaction },
    );
  }

  findAttributeDefinitionsByCode(codes: readonly string[]): Promise<AttributeDefinitionModel[]> {
    return this.attributeDefinitionModel.findAll({
      where: { attributeCode: { [Op.in]: [...codes] }, isActive: true },
    } as FindOptions);
  }

  findCurrentAttributeValues(
    tenantId: string,
    customerId: string,
    definitionIds: readonly string[],
    options: RepositoryOptions = {},
  ): Promise<CustomerAttributeValueModel[]> {
    if (definitionIds.length === 0) return Promise.resolve([]);
    return this.attributeValueModel.findAll({
      where: { tenantId, customerId, attributeDefinitionId: { [Op.in]: [...definitionIds] }, validUntil: null },
      transaction: options.transaction,
    } as FindOptions);
  }

  /** Cierra la vigencia del valor anterior. La tabla es append-only: nunca se sobrescribe. */
  async closeAttributeValue(value: CustomerAttributeValueModel, closedAt: Date, options: RepositoryOptions): Promise<void> {
    value.validUntil = closedAt;
    await value.save({ transaction: options.transaction });
  }

  createAttributeValue(
    values: {
      tenantId: string;
      customerId: string;
      attributeDefinitionId: string;
      valueText: string | null;
      valueNumber: string | null;
      valueBoolean: boolean | null;
      valueJson: Record<string, unknown> | null;
      sourceType: string;
      verificationStatus: string;
      validFrom: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerAttributeValueModel> {
    return this.attributeValueModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        attributeDefinitionId: values.attributeDefinitionId,
        valueText: values.valueText,
        valueNumber: values.valueNumber,
        valueBoolean: values.valueBoolean,
        valueJson: values.valueJson,
        sourceType: values.sourceType,
        evidenceId: null,
        confidenceScore: null,
        verificationStatus: values.verificationStatus,
        validFrom: values.validFrom,
        validUntil: null,
        createdAtValue: values.validFrom,
      },
      { transaction: options.transaction },
    );
  }

  findReferenceContacts(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<CustomerReferenceContactModel[]> {
    return this.referenceModel.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [['id', 'ASC']],
      transaction: options.transaction,
    } as FindOptions);
  }

  findReferenceByPhoneHash(
    tenantId: string,
    customerId: string,
    phoneHash: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerReferenceContactModel | null> {
    return this.referenceModel.findOne({
      where: { tenantId, customerId, phoneHash, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  createReferenceContact(
    values: {
      tenantId: string;
      customerId: string;
      relationshipType: string;
      fullNameHash: string;
      fullNameEncrypted: string | null;
      phoneHash: string;
      phoneEncrypted: string | null;
      phoneLast4: string | null;
      consentBasis: string;
      createdAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerReferenceContactModel> {
    return this.referenceModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        relationshipType: values.relationshipType,
        fullNameHash: values.fullNameHash,
        fullNameEncrypted: values.fullNameEncrypted,
        phoneHash: values.phoneHash,
        phoneEncrypted: values.phoneEncrypted,
        phoneLast4: values.phoneLast4,
        consentBasis: values.consentBasis,
        referenceNotified: false,
        referenceNotifiedAt: null,
        contactabilityStatus: 'not_contacted',
        verificationStatus: 'declared',
        createdAtValue: values.createdAt,
        updatedAtValue: values.createdAt,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  async softDeleteReference(reference: CustomerReferenceContactModel, now: Date, options: RepositoryOptions): Promise<void> {
    reference.deleted = true;
    reference.updatedAtValue = now;
    await reference.save({ transaction: options.transaction });
  }

  findContactMethodByHash(
    tenantId: string,
    customerId: string,
    contactValueHash: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerContactMethodModel | null> {
    return this.contactMethodModel.findOne({
      where: { tenantId, customerId, contactValueHash, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  createContactMethod(
    values: {
      tenantId: string;
      customerId: string;
      contactType: string;
      contactValueHash: string;
      contactValueEncrypted: string | null;
      valueLast4: string | null;
      emailDomain: string | null;
      label: string;
      createdAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerContactMethodModel> {
    return this.contactMethodModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        contactType: values.contactType,
        contactValueHash: values.contactValueHash,
        contactValueEncrypted: values.contactValueEncrypted,
        normalizedValueHash: values.contactValueHash,
        valueLast4: values.valueLast4,
        emailDomain: values.emailDomain,
        label: values.label,
        isPrimary: false,
        status: 'unverified',
        sourceType: 'customer_self_service',
        firstSeenAt: values.createdAt,
        lastSeenAt: values.createdAt,
        createdAtValue: values.createdAt,
        updatedAtValue: values.createdAt,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }
}
