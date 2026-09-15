/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { CustomerEligibilityService } from './application/customer-eligibility.service.js';
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

    return toCustomerMeResponse({ customer, profile, contacts, consents, riskResult, onboardingFlow, assessment });
  }
}
