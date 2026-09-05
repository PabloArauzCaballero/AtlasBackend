/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import { CustomerContactMethodModel, CustomerModel } from '../../../database/models/index.js';

type ContactRepositoryOptions = {
  transaction?: Transaction;
};

/**
 * Contactos del cliente: los métodos de contacto y las columnas de contacto PRINCIPAL que los
 * resumen en `customers`.
 *
 * Están juntos porque se mueven juntos: promover un contacto a principal obliga a sincronizar las
 * dos columnas de `customers` que usa la deduplicación de alta, y verlo desde dos archivos distintos
 * fue justamente lo que dejó esas columnas apuntando al teléfono que el cliente ya había corregido.
 */
@Injectable()
export class CustomerContactsRepository {
  constructor(
    @InjectModel(CustomerContactMethodModel)
    private readonly contactMethodModel: typeof CustomerContactMethodModel,
  ) {}

  /**
   * Sincroniza las columnas de contacto principal del cliente.
   *
   * `customers.primary_phone_hash` / `primary_email_hash` son las que usan la deduplicación de alta
   * y todo lo que resuelve "el contacto del cliente". Quedaban congeladas con lo escrito en el
   * registro: cuando el cliente corregía un teléfono mal tipeado y verificaba el nuevo, estas
   * columnas seguían apuntando al número muerto.
   */
  async updatePrimaryContact(
    customer: CustomerModel,
    values: { contactType: 'phone' | 'email'; contactValueHash: string; valueLast4: string | null; emailDomain: string | null },
    updatedAt: Date,
    options: ContactRepositoryOptions,
  ): Promise<CustomerModel> {
    if (values.contactType === 'phone') {
      customer.primaryPhoneHash = values.contactValueHash;
      customer.primaryPhoneLast4 = values.valueLast4;
    } else {
      customer.primaryEmailHash = values.contactValueHash;
      customer.primaryEmailDomain = values.emailDomain;
    }
    customer.updatedAtValue = updatedAt;
    return customer.save({ transaction: options.transaction });
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
    options: ContactRepositoryOptions,
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

  findContactMethods(tenantId: string, customerId: string): Promise<CustomerContactMethodModel[]> {
    return this.contactMethodModel.findAll({
      where: { tenantId, customerId, deleted: { [Op.ne]: true } },
      order: [
        ['isPrimary', 'DESC'],
        ['id', 'ASC'],
      ],
    } as FindOptions);
  }
}
