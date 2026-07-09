import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExternalDataRepository } from '../external-data.repository.js';
import { ExternalDataRequestDto } from '../external-data.schemas.js';
import { toMode, toProviderCode } from './external-data-policy.util.js';
import { ExternalDataExecutionService } from './external-data-execution.service.js';

@Injectable()
export class ExternalProviderConvenienceService {
  constructor(
    private readonly repository: ExternalDataRepository,
    private readonly execution: ExternalDataExecutionService,
  ) {}

  executeSegip(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.execution.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'SEGIP',
        queryType: 'IDENTITY_VERIFICATION',
        purpose: 'KYC_ONBOARDING',
        decisionStage: 'ONBOARDING',
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }

  executeInfocenter(input: {
    tenantId: string;
    customerId: string;
    body: { documentNumber?: string; decisionStage: string; approvedByAdminId?: string; scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.execution.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: 'INFOCENTER',
        queryType: 'CREDIT_REPORT',
        purpose: 'CREDIT_EVALUATION',
        decisionStage: input.body.decisionStage,
        input: { documentNumber: input.body.documentNumber },
        scenario: input.body.scenario,
        approvedByAdminId: input.body.approvedByAdminId,
      },
    });
  }

  executeQrPayment(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeMappedProvider(input, {
      providerCode: 'QR_GENERIC',
      queryType: 'PAYMENT_VERIFICATION',
      purpose: 'PAYMENT_RECONCILIATION',
      decisionStage: 'PAYMENT_RECONCILIATION',
    });
  }

  executeBankTransfer(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeMappedProvider(input, {
      providerCode: 'BANKING_GENERIC',
      queryType: 'BANK_TRANSFER_VERIFICATION',
      purpose: 'PAYMENT_RECONCILIATION',
      decisionStage: 'PAYMENT_RECONCILIATION',
    });
  }

  executeTelcoPhoneTrust(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeMappedProvider(input, {
      providerCode: 'TELCO_GENERIC',
      queryType: 'PHONE_TRUST_CHECK',
      purpose: 'FRAUD_PREVENTION',
      decisionStage: 'ONBOARDING',
    });
  }

  executeWhatsapp(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeMappedProvider(input, {
      providerCode: 'WHATSAPP_GENERIC',
      queryType: 'WHATSAPP_OTP_VERIFICATION',
      purpose: 'CONTACTABILITY',
      decisionStage: 'CONTACTABILITY',
    });
  }

  executeDigitalTrust(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeMappedProvider(input, {
      providerCode: 'DIGITAL_TRUST_GENERIC',
      queryType: 'DIGITAL_TRUST_CHECK',
      purpose: 'DIGITAL_TRUST',
      decisionStage: 'ONBOARDING',
    });
  }

  createFacebookConnectUrl(input: { tenantId: string; customerId: string }) {
    const state = randomBytes(16).toString('hex');
    return {
      customerId: input.customerId,
      providerCode: 'FACEBOOK_META',
      mode: toMode(process.env.FACEBOOK_META_MODE ?? process.env.META_FACEBOOK_MODE ?? 'mock_local'),
      state,
      connectUrl: `/mock/facebook/oauth/authorize?state=${state}&customerId=${input.customerId}`,
      note: 'URL contractual para mock/sandbox. En producción debe generarse con OAuth oficial de Meta y scopes mínimos.',
    };
  }

  executeFacebookCallback(input: {
    tenantId: string;
    customerId: string;
    body: Record<string, unknown> & { scenario?: string };
    idempotencyKey?: string;
    requestedByUserId?: string;
  }) {
    return this.executeMappedProvider(input, {
      providerCode: 'FACEBOOK_META',
      queryType: 'SOCIAL_TRUST_CHECK',
      purpose: 'DIGITAL_TRUST',
      decisionStage: 'ONBOARDING',
    });
  }

  async retryProviderRequest(input: {
    tenantId: string;
    requestId: string;
    body: Partial<ExternalDataRequestDto> & { input?: Record<string, unknown> };
    requestedByUserId?: string;
  }) {
    const original = await this.repository.findProviderRequestByIdAndTenant(input.tenantId, input.requestId);
    if (!original) throw new NotFoundException('Solicitud de provider externo no encontrada.');
    const originalProvider = original.providerId ? await this.repository.findProviderById(String(original.providerId)) : null;
    const providerCode = toProviderCode(input.body.providerCode ?? String(originalProvider?.providerCode ?? ''));
    if (!input.body.input) {
      throw new BadRequestException(
        'RETRY_REQUIRES_NEW_INPUT: por privacidad no se guarda el input claro original; reenvía input sanitizado.',
      );
    }
    return this.execution.executeExternalDataRequest({
      tenantId: input.tenantId,
      requestedByUserId: input.requestedByUserId,
      retryOfRequestId: input.requestId,
      body: {
        customerId: input.body.customerId ?? (original.customerId ? String(original.customerId) : undefined),
        providerCode,
        queryType: input.body.queryType ?? String(original.requestType ?? ''),
        purpose: input.body.purpose ?? String(original.purposeCode ?? 'MANUAL_REVIEW'),
        decisionStage: input.body.decisionStage ?? String(original.decisionStage ?? 'MANUAL_REVIEW'),
        input: input.body.input,
        scenario: input.body.scenario,
        approvedByAdminId: input.body.approvedByAdminId,
        forceRefresh: true,
      },
    });
  }

  private executeMappedProvider(
    input: {
      tenantId: string;
      customerId: string;
      body: Record<string, unknown> & { scenario?: string };
      idempotencyKey?: string;
      requestedByUserId?: string;
    },
    mapping: { providerCode: string; queryType: string; purpose: string; decisionStage: string },
  ) {
    return this.execution.executeExternalDataRequest({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId,
      body: {
        customerId: input.customerId,
        providerCode: mapping.providerCode,
        queryType: mapping.queryType,
        purpose: mapping.purpose,
        decisionStage: mapping.decisionStage,
        input: input.body,
        scenario: input.body.scenario,
      },
    });
  }
}
