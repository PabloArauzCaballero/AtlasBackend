import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import { ContactVerificationAttemptModel, CustomerContactMethodModel } from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `customer-onboarding.repository.ts`.
 * Responsabilidad única: método de contacto del cliente (teléfono/email) y sus intentos de
 * verificación. Split mecánico, sin cambio de comportamiento.
 */
@Injectable()
export class CustomerContactVerificationRepository {
  constructor(
    @InjectModel(CustomerContactMethodModel) private readonly contactMethodModel: typeof CustomerContactMethodModel,
    @InjectModel(ContactVerificationAttemptModel)
    private readonly contactVerificationAttemptModel: typeof ContactVerificationAttemptModel,
  ) {}

  findCustomerContactMethod(
    tenantId: string,
    customerId: string,
    contactType: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerContactMethodModel | null> {
    return this.contactMethodModel.findOne({
      where: { tenantId, customerId, contactType, deleted: { [Op.ne]: true } },
      order: [
        ['isPrimary', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  async markContactMethodVerified(
    contactMethod: CustomerContactMethodModel,
    verifiedAt: Date,
    options: RepositoryOptions,
  ): Promise<CustomerContactMethodModel> {
    contactMethod.status = 'verified';
    contactMethod.updatedAtValue = verifiedAt;
    return contactMethod.save({ transaction: options.transaction });
  }

  createContactVerificationAttempt(
    values: {
      tenantId: string;
      contactMethodId: string;
      verificationMethod: string;
      verificationStatus: string;
      confidenceScore: string | null;
      attemptedAt: Date;
      verifiedAt: Date | null;
      failureReasonCode: string | null;
    },
    options: RepositoryOptions,
  ): Promise<ContactVerificationAttemptModel> {
    return this.contactVerificationAttemptModel.create(
      {
        tenantId: values.tenantId,
        contactMethodId: values.contactMethodId,
        providerRequestId: null,
        verificationMethod: values.verificationMethod,
        verificationStatus: values.verificationStatus,
        confidenceScore: values.confidenceScore,
        attemptedAt: values.attemptedAt,
        verifiedAt: values.verifiedAt,
        failureReasonCode: values.failureReasonCode,
        createdAtValue: values.attemptedAt,
      },
      { transaction: options.transaction },
    );
  }

  findLatestContactVerificationAttempt(
    tenantId: string,
    contactMethodId: string,
    options: RepositoryOptions = {},
  ): Promise<ContactVerificationAttemptModel | null> {
    return this.contactVerificationAttemptModel.findOne({
      where: { tenantId, contactMethodId },
      order: [
        ['attemptedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as FindOptions);
  }

  async updateContactVerificationAttempt(
    attempt: ContactVerificationAttemptModel,
    values: { verificationStatus: string; verifiedAt: Date | null; failureReasonCode: string | null; confidenceScore: string | null },
    options: RepositoryOptions,
  ): Promise<ContactVerificationAttemptModel> {
    attempt.verificationStatus = values.verificationStatus;
    attempt.verifiedAt = values.verifiedAt;
    attempt.failureReasonCode = values.failureReasonCode;
    attempt.confidenceScore = values.confidenceScore;
    return attempt.save({ transaction: options.transaction });
  }
}
