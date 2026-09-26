/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
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

  /**
   * Contacto sobre el que toca actuar para un tipo dado.
   *
   * El orden anterior era `isPrimary DESC, id DESC` a secas, y eso convertía la corrección de un
   * teléfono mal escrito en un callejón sin salida: el contacto nuevo nace `isPrimary: false`, así
   * que la consulta seguía devolviendo el original y el código se enviaba una y otra vez al número
   * equivocado. Y si el primario ya estaba verificado, el secundario no podía verificarse nunca
   * porque el flujo respondía `CONTACT_ALREADY_VERIFIED` mirando al primario.
   *
   * Ahora se busca primero entre los que FALTA verificar (el primario tiene preferencia dentro de
   * ese conjunto, luego el más reciente). Solo si están todos verificados se devuelve el primario,
   * que es el caso en el que `CONTACT_ALREADY_VERIFIED` sí es la respuesta correcta.
   */
  async findCustomerContactMethod(
    tenantId: string,
    customerId: string,
    contactType: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerContactMethodModel | null> {
    const order: FindOptions['order'] = [
      ['isPrimary', 'DESC'],
      ['id', 'DESC'],
    ];
    const base = { tenantId, customerId, contactType, deleted: { [Op.ne]: true } };

    const pending = await this.contactMethodModel.findOne({
      where: { ...base, status: { [Op.ne]: 'verified' } },
      order,
      transaction: options.transaction,
    } as FindOptions);
    if (pending) return pending;

    return this.contactMethodModel.findOne({
      where: base,
      order,
      transaction: options.transaction,
    } as FindOptions);
  }

  /**
   * Contacto elegido explícitamente por el cliente (`contactMethodId`).
   *
   * Se filtra por tenant, cliente y tipo además de por id: sin eso, un id ajeno permitiría pedir un
   * código sobre el contacto de otra persona y adjuntar la verificación al expediente propio.
   */
  findCustomerContactMethodById(
    tenantId: string,
    customerId: string,
    contactType: string,
    contactMethodId: string,
    options: RepositoryOptions = {},
  ): Promise<CustomerContactMethodModel | null> {
    return this.contactMethodModel.findOne({
      where: { id: contactMethodId, tenantId, customerId, contactType, deleted: { [Op.ne]: true } },
      transaction: options.transaction,
    } as FindOptions);
  }

  /**
   * Convierte en primario el contacto recién verificado y degrada al anterior del mismo tipo.
   *
   * Es la segunda mitad de la corrección: verificar el teléfono nuevo no servía de nada si el
   * cliente seguía teniendo como principal el que había escrito mal — todo lo que mira "el contacto
   * del cliente" (notificaciones, deduplicación, recuperación de cuenta) apuntaba al número muerto.
   */
  async promoteContactMethodToPrimary(
    contactMethod: CustomerContactMethodModel,
    now: Date,
    options: RepositoryOptions,
  ): Promise<CustomerContactMethodModel[]> {
    const demoted = await this.contactMethodModel.findAll({
      where: {
        tenantId: contactMethod.tenantId,
        customerId: contactMethod.customerId,
        contactType: contactMethod.contactType,
        isPrimary: true,
        id: { [Op.ne]: contactMethod.id },
        deleted: { [Op.ne]: true },
      },
      transaction: options.transaction,
    } as FindOptions);

    for (const previous of demoted) {
      previous.isPrimary = false;
      previous.updatedAtValue = now;
      await previous.save({ transaction: options.transaction });
    }

    contactMethod.isPrimary = true;
    contactMethod.updatedAtValue = now;
    await contactMethod.save({ transaction: options.transaction });

    return demoted;
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
