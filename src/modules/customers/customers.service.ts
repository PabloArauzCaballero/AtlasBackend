/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { maskEmailForDisplay } from '../../common/utils/contact/mask-email.util.js';
import { decryptSecretEnvelope } from '../../common/utils/crypto/envelope-encryption.util.js';
import { CustomerEligibilityService } from './application/customer-eligibility.service.js';
import type { CustomerContactMethodModel } from '../../database/models/index.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomerContactsRepository } from './repositories/customer-contacts.repository.js';
import { CustomerMeResponseDto } from './customers.dtos.js';
import { toCustomerMeResponse } from './customers.mapper.js';
import { CustomerEligibilityRepository } from './repositories/customer-eligibility.repository.js';

@Injectable()
export class CustomersService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly customerContactsRepository: CustomerContactsRepository,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
    private readonly eligibilityService: CustomerEligibilityService,
  ) {}

  /**
   * Perfil agregado del cliente.
   *
   * `onboarding` y `nextStep` ya no se inventan aquí: el primero se lee de `onboarding_flows` (la
   * tabla existe desde el inicio del proyecto y el mapper la daba por ausente) y el segundo viene
   * del mismo evaluador que decide la habilitación, para que esta pantalla y la puerta de entrada
   * al crédito no puedan decir cosas distintas.
   */
  async getCustomerMe(tenantId: string, customerId: string, currentUser: AuthenticatedUser): Promise<CustomerMeResponseDto> {
    assertOwnCustomerResource(currentUser, customerId);

    const customer = await this.customersRepository.findById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const [profile, contacts, consents, riskResult, onboardingFlow, assessment] = await Promise.all([
      this.customersRepository.findCurrentProfile(tenantId, customerId),
      this.customerContactsRepository.findContactMethods(tenantId, customerId),
      this.customersRepository.findCustomerConsents(tenantId, customerId),
      this.customersRepository.findLatestRiskResult(tenantId, customerId),
      this.eligibilityRepository.findLatestOnboardingFlow(tenantId, customerId),
      this.eligibilityService.evaluate(tenantId, customerId),
    ]);

    return toCustomerMeResponse({
      customer,
      profile,
      contacts,
      consents,
      riskResult,
      onboardingFlow,
      assessment,
      maskedContacts: await this.maskEmails(contacts),
    });
  }

  /**
   * Los correos viven cifrados y sólo con el dominio en claro, así que la pantalla de «mis datos» no tenía qué enseñar.
   * Se descifran AQUÍ, para su propio dueño (`assertOwnCustomerResource` ya pasó), y salen enmascarados. Un sobre
   * ilegible no tumba la respuesta: ese contacto simplemente sale sin valor.
   */
  private async maskEmails(contacts: CustomerContactMethodModel[]): Promise<Map<string, string>> {
    const masked = new Map<string, string>();
    for (const contact of contacts) {
      if (contact.contactType !== 'email' || contact.contactValueEncrypted === null) continue;
      try {
        const value = maskEmailForDisplay(await decryptSecretEnvelope(contact.contactValueEncrypted));
        if (value) masked.set(String(contact.id), value);
      } catch {
        // Sobre ilegible: ese contacto queda sin valor enmascarado y la app muestra «Correo registrado».
      }
    }
    return masked;
  }
}
