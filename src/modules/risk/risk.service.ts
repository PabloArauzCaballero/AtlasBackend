import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { RiskAssessmentResultResponseDto } from './risk.dtos.js';
import { toRiskAssessmentResultResponse } from './risk.mapper.js';
import { RiskRepository } from './risk.repository.js';

function assertCustomerAccess(customerId: string, currentUser: AuthenticatedUser): void {
  if (currentUser.role === 'customer' && currentUser.customerId !== customerId) {
    throw new ForbiddenException('El token del cliente no corresponde al riesgo solicitado.');
  }
}

@Injectable()
export class RiskService {
  constructor(
    private readonly riskRepository: RiskRepository,
    private readonly customersRepository: CustomersRepository,
  ) {}

  async getLatestCustomerRiskResult(input: {
    tenantId: string;
    customerId: string;
    currentUser: AuthenticatedUser;
  }): Promise<RiskAssessmentResultResponseDto | null> {
    assertCustomerAccess(input.customerId, input.currentUser);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const result = await this.riskRepository.findLatestCustomerRiskResult(input.tenantId, input.customerId);
    return result ? toRiskAssessmentResultResponse(result) : null;
  }
}
