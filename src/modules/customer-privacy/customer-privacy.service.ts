import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { createStableCode, sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { ConsentsRepository } from '../consents/consents.repository.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomerPrivacyRepository } from './customer-privacy.repository.js';
import { ConsentDecisionsDto, DataSubjectRequestDto } from './customer-privacy.schemas.js';

@Injectable()
export class CustomerPrivacyService {
  constructor(
    private readonly privacyRepository: CustomerPrivacyRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly consentsRepository: ConsentsRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async registerConsentDecisions(input: {
    tenantId: string;
    customerId: string;
    body: ConsentDecisionsDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
    ipAddress: string | null;
    channel: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let processed = 0;
      let hasRevoked = false;
      for (const decision of input.body.decisions) {
        const doc = await this.consentsRepository.findActiveDocumentById(input.tenantId, decision.consentDocumentId);
        if (!doc) throw new UnprocessableEntityException('CONSENT_DOCUMENT_NOT_ACTIVE');
        const happenedAt = decision.decidedAt ? new Date(decision.decidedAt) : now;
        const consent = await this.privacyRepository.createCustomerConsent(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            consentDocumentId: decision.consentDocumentId,
            purposeCode: decision.purposeCode,
            granted: decision.decision === 'granted',
            revoked: decision.decision === 'revoked',
            channel: input.channel,
            sessionId: decision.sessionId ?? null,
            ipAddress: input.ipAddress,
            happenedAt,
          },
          { transaction },
        );
        await this.privacyRepository.createConsentEvent(
          {
            tenantId: input.tenantId,
            customerConsentId: String(consent.id),
            eventType: decision.decision,
            channel: input.channel,
            sessionId: decision.sessionId ?? null,
            ipAddress: input.ipAddress,
            actorType: input.currentUser.role,
            notes: 'Decisión de consentimiento registrada desde endpoint batch.',
            happenedAt,
          },
          { transaction },
        );
        processed += 1;
        hasRevoked = hasRevoked || decision.decision === 'revoked';
      }
      if (hasRevoked) {
        await this.privacyRepository.createStatusEvent(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            previousStatus: customer.lifecycleStatus,
            newStatus: customer.lifecycleStatus ?? 'registered',
            reasonCode: 'consent_revoked',
            actorType: input.currentUser.role,
            happenedAt: now,
            notes: 'Se registró revocación de consentimiento. Revisar impacto operativo según política.',
          },
          { transaction },
        );
      }
      await this.privacyRepository.createActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.decisions[0]?.sessionId ?? null,
          eventName: 'privacy_consent_decisions_registered',
          payload: { processed, idempotencyKeyHash: sha256Hex(input.idempotencyKey) },
          occurredAt: now,
        },
        { transaction },
      );
      await this.privacyRepository.createAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actionCode: 'privacy.consent_decisions',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          payload: { processed, hasRevoked },
          occurredAt: now,
        },
        { transaction },
      );
      return { customerId: input.customerId, processed, currentConsentStatus: hasRevoked ? 'requires_review' : 'complete' };
    });
  }

  async createDataSubjectRequest(input: {
    tenantId: string;
    customerId: string;
    body: DataSubjectRequestDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
    ipAddress: string | null;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const now = new Date();
    const dueAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    return this.sequelize.transaction(async (transaction) => {
      const request = await this.privacyRepository.createDataSubjectRequest(
        {
          tenantId: input.tenantId,
          requestCode: createStableCode('DSR'),
          customerId: input.customerId,
          requestType: input.body.requestType,
          requestedAt: now,
          dueAt,
        },
        { transaction },
      );
      await this.privacyRepository.createActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: null,
          eventName: 'data_subject_request_created',
          payload: { requestType: input.body.requestType, idempotencyKeyHash: sha256Hex(input.idempotencyKey) },
          occurredAt: now,
        },
        { transaction },
      );
      await this.privacyRepository.createAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actionCode: 'privacy.data_subject_request.create',
          targetType: 'data_subject_request',
          targetId: String(request.id),
          ipAddress: input.ipAddress,
          payload: { customerId: input.customerId, requestType: input.body.requestType },
          occurredAt: now,
        },
        { transaction },
      );
      return { dataSubjectRequestId: String(request.id), status: 'received' };
    });
  }
}
