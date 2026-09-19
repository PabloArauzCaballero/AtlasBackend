/**
 * @file Adaptador local del puerto de hechos de Riesgo (AT-027).
 * @business Lee del cliente lo que Riesgo tiene autorizado a leer: estado, consentimiento, contactos
 *   verificados e identidad; con la misma lógica que tenía el servicio, ahora detrás de un contrato.
 * @system Envuelve `CustomersRepository` y las lecturas de `RiskRepository`; la sustitución por un
 *   adaptador remoto no toca el motor.
 */
import { Injectable } from '@nestjs/common';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { RiskRepository } from '../risk.repository.js';
import type { RiskInputFacts, RiskInputFactsPort } from '../application/ports/risk-input-facts.port.js';

@Injectable()
export class LocalRiskInputFactsAdapter implements RiskInputFactsPort {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly risk: RiskRepository,
  ) {}

  async loadFacts(tenantId: string, customerId: string): Promise<RiskInputFacts> {
    const readAt = new Date().toISOString();
    const customer = await this.customers.findById(tenantId, customerId);
    if (!customer) {
      return Object.freeze({
        exists: false,
        lifecycleStatus: null,
        hasGrantedConsent: false,
        verifiedContactCount: 0,
        hasIdentity: false,
        readAt,
      });
    }
    const [consents, contacts, identities] = await Promise.all([
      this.risk.findCustomerConsents(tenantId, customerId),
      this.risk.findCustomerContacts(tenantId, customerId),
      this.risk.findIdentityDocuments(tenantId, customerId),
    ]);
    return Object.freeze({
      exists: true,
      lifecycleStatus: customer.lifecycleStatus ?? null,
      hasGrantedConsent: consents.some((consent) => consent.granted === true && !consent.revokedAt),
      verifiedContactCount: contacts.filter((contact) => contact.status === 'verified').length,
      hasIdentity: identities.length > 0,
      readAt,
    });
  }
}
