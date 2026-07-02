import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomerMeResponseDto } from './customers.dtos.js';
import { toCustomerMeResponse } from './customers.mapper.js';

@Injectable()
export class CustomersService {
  constructor(private readonly customersRepository: CustomersRepository) {}

  async getCustomerMe(tenantId: string, customerId: string, currentUser: AuthenticatedUser): Promise<CustomerMeResponseDto> {
    assertOwnCustomerResource(currentUser, customerId);

    const customer = await this.customersRepository.findById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const [profile, contacts, consents, riskResult] = await Promise.all([
      this.customersRepository.findCurrentProfile(tenantId, customerId),
      this.customersRepository.findContactMethods(tenantId, customerId),
      this.customersRepository.findCustomerConsents(tenantId, customerId),
      this.customersRepository.findLatestRiskResult(tenantId, customerId),
    ]);

    return toCustomerMeResponse({ customer, profile, contacts, consents, riskResult });
  }
}
