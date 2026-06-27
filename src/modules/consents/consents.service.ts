import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { ConsentDocumentResponseDto, CustomerConsentResponseDto } from './consents.dtos.js';
import { toConsentDocumentResponse, toCustomerConsentResponse } from './consents.mapper.js';
import { ConsentsRepository } from './consents.repository.js';
import { CreateCustomerConsentDto, ListActiveConsentDocumentsQueryDto } from './consents.schemas.js';

function assertCustomerAccess(customerId: string, currentUser: AuthenticatedUser): void {
  if (currentUser.role === 'customer' && currentUser.customerId !== customerId) {
    throw new ForbiddenException('El token del cliente no corresponde al consentimiento solicitado.');
  }
}

@Injectable()
export class ConsentsService {
  constructor(
    private readonly consentsRepository: ConsentsRepository,
    private readonly customersRepository: CustomersRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async listActiveDocuments(
    tenantId: string,
    query: ListActiveConsentDocumentsQueryDto,
  ): Promise<ConsentDocumentResponseDto[]> {
    const documents = await this.consentsRepository.findActiveDocuments(tenantId, query);
    return documents.map(toConsentDocumentResponse);
  }

  async recordCustomerConsent(input: {
    tenantId: string;
    customerId: string;
    body: CreateCustomerConsentDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }): Promise<CustomerConsentResponseDto> {
    assertCustomerAccess(input.customerId, input.currentUser);

    const [customer, document] = await Promise.all([
      this.customersRepository.findById(input.tenantId, input.customerId),
      this.consentsRepository.findDocumentById(input.tenantId, input.body.consentDocumentId),
    ]);

    if (!customer) {
      throw new NotFoundException('Cliente no encontrado para registrar consentimiento.');
    }

    if (!document) {
      throw new NotFoundException('Documento de consentimiento no encontrado.');
    }

    const happenedAt = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const consent = await this.consentsRepository.createCustomerConsent(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          consentDocumentId: input.body.consentDocumentId,
          purposeCode: input.body.purposeCode,
          granted: input.body.granted,
          channel: input.body.channel,
          sessionId: input.body.sessionId ?? null,
          ipAddress: input.ipAddress,
          deviceFingerprintSnapshot: input.body.deviceFingerprintSnapshot ?? null,
          userAgent: input.body.userAgent ?? null,
          evidenceSnapshotUrl: input.body.evidenceSnapshotUrl ?? null,
          happenedAt,
        },
        { transaction },
      );

      await this.consentsRepository.createConsentEvent(
        {
          tenantId: input.tenantId,
          customerConsentId: String(consent.id),
          eventType: input.body.granted ? 'granted' : 'revoked',
          channel: input.body.channel,
          sessionId: input.body.sessionId ?? null,
          ipAddress: input.ipAddress,
          deviceFingerprintSnapshot: input.body.deviceFingerprintSnapshot ?? null,
          triggeredByType: input.currentUser.role === 'customer' ? 'customer' : 'internal_user',
          triggeredByInternalUserId: input.currentUser.internalUserId ?? null,
          notes: input.body.notes ?? null,
          happenedAt,
        },
        { transaction },
      );

      return toCustomerConsentResponse(consent);
    });
  }
}
