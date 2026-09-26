/**
 * @file Servicio de aplicación: la cola de contactos declarados y sin verificar.
 * @business Permite a operaciones ver a quién no le llegó el código de verificación y reenviárselo.
 * @system Cruza `customer_contact_methods.status = 'unverified'` con su cliente; sin escrituras.
 */
import { Injectable } from '@nestjs/common';
import { CustomerModel } from '../../database/models/index.js';
import { CustomerContactsRepository } from '../customers/repositories/customer-contacts.repository.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { PendingContactVerificationItemDto } from './operations.dtos.js';

@Injectable()
export class PendingContactVerificationService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly customerContactsRepository: CustomerContactsRepository,
  ) {}

  /**
   * Sale de `customer_contact_methods.status = 'unverified'`, no del estado del cliente: una
   * cuenta puede estar `active` y aun así tener el correo sin confirmar, y ése es justo el caso
   * que hay que poder ver para reenviarle el código.
   */
  async list(tenantId: string): Promise<{ items: PendingContactVerificationItemDto[] }> {
    const contacts = await this.customerContactsRepository.listUnverified(tenantId);
    const customerIds = [...new Set(contacts.map((contact) => contact.customerId).filter((id): id is string => Boolean(id)))];
    const customers = await this.customersRepository.findManyByIds(tenantId, customerIds);
    const byId = new Map(customers.map((customer) => [customer.id, customer]));
    const items = contacts
      .filter((contact) => contact.customerId && byId.has(contact.customerId))
      .map((contact) => {
        const customer = byId.get(contact.customerId as string) as CustomerModel;
        return {
          customerId: customer.id,
          customerCode: customer.customerCode ?? null,
          lifecycleStatus: customer.lifecycleStatus ?? null,
          customerCreatedAt: customer.createdAtValue?.toISOString() ?? null,
          contactMethodId: contact.id,
          contactType: contact.contactType ?? null,
          valueLast4: contact.valueLast4 ?? null,
          emailDomain: contact.emailDomain ?? null,
          isPrimary: contact.isPrimary ?? null,
          contactCreatedAt: contact.createdAtValue?.toISOString() ?? null,
        };
      });
    return { items };
  }
}
