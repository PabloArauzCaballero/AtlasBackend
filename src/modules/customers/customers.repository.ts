import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import {
  CustomerConsentModel,
  CustomerContactMethodModel,
  CustomerModel,
  CustomerProfileVersionModel,
  CustomerStatusEventModel,
  RiskAssessmentResultModel,
} from '../../database/models/index.js';

type RepositoryOptions = {
  transaction?: Transaction;
};

@Injectable()
export class CustomersRepository {
  constructor(
    @InjectModel(CustomerModel) private readonly customerModel: typeof CustomerModel,
    @InjectModel(CustomerProfileVersionModel)
    private readonly profileModel: typeof CustomerProfileVersionModel,
    @InjectModel(CustomerContactMethodModel)
    private readonly contactMethodModel: typeof CustomerContactMethodModel,
    @InjectModel(CustomerStatusEventModel)
    private readonly statusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(CustomerConsentModel)
    private readonly customerConsentModel: typeof CustomerConsentModel,
    @InjectModel(RiskAssessmentResultModel)
    private readonly riskResultModel: typeof RiskAssessmentResultModel,
  ) {}

  findById(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<CustomerModel | null> {
    return this.customerModel.findOne({
      where: { id: customerId, tenantId, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  /**
   * Usado por `NotificationBroadcastService` para resolver el destinatario "todos los
   * customers" de un broadcast de admin. Excluye clientes eliminados y bloqueados — no tiene
   * sentido notificar a una cuenta bloqueada, y evita construir una lista de miles de ids solo
   * para descartarlos después caso por caso.
   */
  async listActiveCustomerIds(tenantId: string): Promise<string[]> {
    const rows = await this.customerModel.findAll({
      where: {
        tenantId,
        deleted: { [Op.ne]: true },
        // `lifecycleStatus` es nullable — `Op.ne` por sí solo excluiría también los NULL (NULL !=
        // 'blocked' no es true en SQL), así que el OR explícito con NULL es necesario para no
        // dejar afuera clientes que simplemente no tienen el campo seteado.
        [Op.or]: [{ lifecycleStatus: null }, { lifecycleStatus: { [Op.ne]: 'blocked' } }],
      } as never,
      attributes: ['id'],
    } as FindOptions);
    return rows.map((row) => String(row.id));
  }

  findByContactHash(tenantId: string, contactHashes: { phoneHash?: string; emailHash?: string }): Promise<CustomerModel | null> {
    const orConditions = [];

    if (contactHashes.phoneHash) {
      orConditions.push({ primaryPhoneHash: contactHashes.phoneHash });
    }

    if (contactHashes.emailHash) {
      orConditions.push({ primaryEmailHash: contactHashes.emailHash });
    }

    if (orConditions.length === 0) {
      return Promise.resolve(null);
    }

    return this.customerModel.findOne({
      where: {
        tenantId,
        deleted: { [Op.ne]: true },
        [Op.or]: orConditions,
      },
    } as FindOptions);
  }

  createCustomer(
    values: {
      tenantId: string;
      customerCode: string;
      customerUuid: string;
      primaryPhoneHash: string | null;
      primaryPhoneLast4: string | null;
      primaryEmailHash: string | null;
      primaryEmailDomain: string | null;
      lifecycleStatus: string;
      createdAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerModel> {
    return this.customerModel.create(
      {
        tenantId: values.tenantId,
        customerCode: values.customerCode,
        customerUuid: values.customerUuid,
        primaryPhoneHash: values.primaryPhoneHash,
        primaryPhoneEncrypted: null,
        primaryPhoneLast4: values.primaryPhoneLast4,
        primaryEmailHash: values.primaryEmailHash,
        primaryEmailEncrypted: null,
        primaryEmailDomain: values.primaryEmailDomain,
        lifecycleStatus: values.lifecycleStatus,
        currentProfileVersionId: null,
        closedAt: null,
        createdAtValue: values.createdAt,
        updatedAtValue: values.createdAt,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  createProfileVersion(
    values: {
      tenantId: string;
      customerId: string;
      firstName: string | null;
      lastName: string | null;
      fullNameNormalized: string | null;
      birthDate: string | null;
      preferredLanguage: string;
      marketingOptIn: boolean;
      sourceType: string;
      createdAt: Date;
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
        ageAtCapture: null,
        genderDeclared: null,
        preferredLanguage: values.preferredLanguage,
        marketingOptIn: values.marketingOptIn,
        sourceType: values.sourceType,
        validFrom: values.createdAt,
        validUntil: null,
        supersedesVersionId: null,
        createdAtValue: values.createdAt,
      },
      { transaction: options.transaction },
    );
  }

  updateCurrentProfileVersion(
    customer: CustomerModel,
    profileVersionId: string,
    updatedAt: Date,
    options: RepositoryOptions,
  ): Promise<CustomerModel> {
    customer.currentProfileVersionId = profileVersionId;
    customer.updatedAtValue = updatedAt;
    return customer.save({ transaction: options.transaction });
  }

  createStatusEvent(
    values: {
      tenantId: string;
      customerId: string;
      previousStatus: string | null;
      newStatus: string;
      reasonCode: string;
      changedByType: string;
      happenedAt: Date;
      notes: string | null;
    },
    options: RepositoryOptions,
  ): Promise<CustomerStatusEventModel> {
    return this.statusEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        previousStatus: values.previousStatus,
        newStatus: values.newStatus,
        reasonCode: values.reasonCode,
        changedByType: values.changedByType,
        happenedAt: values.happenedAt,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
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
      isPrimary: boolean;
      sourceType: string;
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
        label: values.contactType === 'phone' ? 'primary_phone' : 'primary_email',
        isPrimary: values.isPrimary,
        status: 'unverified',
        sourceType: values.sourceType,
        firstSeenAt: values.createdAt,
        lastSeenAt: values.createdAt,
        createdAtValue: values.createdAt,
        updatedAtValue: values.createdAt,
        deleted: false,
      },
      { transaction: options.transaction },
    );
  }

  findCurrentProfile(tenantId: string, customerId: string): Promise<CustomerProfileVersionModel | null> {
    return this.profileModel.findOne({
      where: { tenantId, customerId, validUntil: null },
      order: [
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }

  findContactMethods(tenantId: string, customerId: string): Promise<CustomerContactMethodModel[]> {
    return this.contactMethodModel.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [
        ['isPrimary', 'DESC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }

  findCustomerConsents(tenantId: string, customerId: string): Promise<CustomerConsentModel[]> {
    return this.customerConsentModel.findAll({
      where: { tenantId, customerId },
      order: [['createdAtValue', 'DESC']],
    } as FindOptions);
  }

  findLatestRiskResult(tenantId: string, customerId: string): Promise<RiskAssessmentResultModel | null> {
    return this.riskResultModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['decidedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }
}
