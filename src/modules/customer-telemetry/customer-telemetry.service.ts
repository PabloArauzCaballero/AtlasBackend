import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomerTelemetryRepository } from './customer-telemetry.repository.js';
import { TelemetryBatchDto } from './customer-telemetry.schemas.js';

function metadataHasRawContacts(value: unknown): boolean {
  // Normaliza separadores (snake_case, kebab-case, espacios) antes de comparar: sin esto,
  // "raw_contacts" o "contact-list" no contienen "rawcontacts"/"contactlist" como substring y
  // el filtro de privacidad se evade con solo cambiar la convención de nombres.
  const text = JSON.stringify(value ?? {})
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return text.includes('rawcontacts') || text.includes('contactlist') || text.includes('phonebook') || text.includes('agenda');
}

function asRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ?? {};
}

@Injectable()
export class CustomerTelemetryService {
  constructor(
    private readonly telemetryRepository: CustomerTelemetryRepository,
    private readonly customersRepository: CustomersRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async ingestBatch(input: {
    tenantId: string;
    customerId: string;
    body: TelemetryBatchDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
    ipAddress: string | null;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);
    if (input.body.events.length + input.body.onDeviceMetrics.length === 0) {
      throw new BadRequestException('El batch debe incluir al menos un evento o métrica.');
    }
    if (JSON.stringify(input.body).length > 250_000) {
      throw new PayloadTooLargeException('PAYLOAD_TOO_LARGE');
    }
    if (metadataHasRawContacts(input.body)) {
      throw new UnprocessableEntityException('RAW_CONTACTS_NOT_ALLOWED');
    }

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const deviceLink = await this.telemetryRepository.findCustomerDeviceLink(input.tenantId, input.customerId, input.body.deviceId);
    if (!deviceLink && input.currentUser.role === 'customer') {
      throw new ForbiddenException('El dispositivo no está vinculado al cliente.');
    }
    const session = await this.telemetryRepository.findCustomerSession(input.tenantId, input.customerId, input.body.sessionId);
    if (!session && input.currentUser.role === 'customer') {
      throw new ForbiddenException('La sesión no pertenece al cliente.');
    }

    const now = new Date();
    const flow = await this.telemetryRepository.findLatestOnboardingFlow(input.tenantId, input.customerId);
    let acceptedEvents = 0;
    let acceptedMetrics = 0;
    let formEventCount = 0;
    let permissionEventCount = 0;

    await this.sequelize.transaction(async (transaction) => {
      for (const event of input.body.events) {
        const metadata = asRecord(event.metadata);
        const occurredAt = new Date(event.occurredAt);
        if (event.eventType === 'form_field_interaction') {
          formEventCount += 1;
          await this.telemetryRepository.createFormFieldEvent(
            {
              tenantId: input.tenantId,
              onboardingFlowId: flow ? String(flow.id) : null,
              fieldCode: event.eventCode,
              interactionType: typeof metadata.interactionType === 'string' ? metadata.interactionType : 'interaction',
              usedCopyPaste: typeof metadata.usedCopyPaste === 'boolean' ? metadata.usedCopyPaste : null,
              correctionCount: typeof metadata.corrections === 'number' ? metadata.corrections : null,
              focusDurationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : null,
              occurredAt,
            },
            { transaction },
          );
        } else if (event.eventType === 'permission_event') {
          permissionEventCount += 1;
          await this.telemetryRepository.createPermissionEvent(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              sessionId: input.body.sessionId,
              onboardingFlowId: flow ? String(flow.id) : null,
              permissionCode: event.eventCode,
              granted: typeof metadata.granted === 'boolean' ? metadata.granted : event.eventCode.includes('granted'),
              occurredAt,
            },
            { transaction },
          );
        } else if (event.eventType === 'auth_event') {
          await this.telemetryRepository.createAuthEvent(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              sessionId: input.body.sessionId,
              deviceId: input.body.deviceId,
              eventType: event.eventCode,
              loginSuccessful: typeof metadata.loginSuccessful === 'boolean' ? metadata.loginSuccessful : null,
              failureReasonCode: typeof metadata.failureReasonCode === 'string' ? metadata.failureReasonCode : null,
              occurredAt,
              ipAddress: input.ipAddress,
            },
            { transaction },
          );
        } else if (event.eventType === 'device_risk_event') {
          await this.telemetryRepository.createDeviceRiskEvent(
            {
              tenantId: input.tenantId,
              deviceId: input.body.deviceId,
              eventType: event.eventCode,
              reasonCode: typeof metadata.reasonCode === 'string' ? metadata.reasonCode : null,
              evidence: metadata,
              occurredAt,
            },
            { transaction },
          );
        } else if (event.eventType === 'sim_observation') {
          await this.telemetryRepository.createSimObservation(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              sessionId: input.body.sessionId,
              deviceId: input.body.deviceId,
              metadata,
              occurredAt,
            },
            { transaction },
          );
        } else if (event.eventType === 'ip_reputation_observation') {
          await this.telemetryRepository.createIpReputation(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              sessionId: input.body.sessionId,
              deviceId: input.body.deviceId,
              ipAddress: input.ipAddress,
              metadata,
              occurredAt,
            },
            { transaction },
          );
        } else if (event.eventType === 'onboarding_step_event') {
          await this.telemetryRepository.createOnboardingStepEvent(
            {
              tenantId: input.tenantId,
              onboardingFlowId: flow ? String(flow.id) : null,
              stepCode: event.eventCode,
              eventType: typeof metadata.eventType === 'string' ? metadata.eventType : 'telemetry',
              payload: metadata,
              occurredAt,
            },
            { transaction },
          );
        } else if (event.eventType === 'customer_action') {
          await this.telemetryRepository.createCustomerAction(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              sessionId: input.body.sessionId,
              deviceId: input.body.deviceId,
              eventName: event.eventCode,
              screenName: typeof metadata.screenName === 'string' ? metadata.screenName : null,
              payload: metadata,
              occurredAt,
            },
            { transaction },
          );
        } else {
          await this.telemetryRepository.createCustomerObservation(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              sessionId: input.body.sessionId,
              deviceId: input.body.deviceId,
              observationCode: event.eventCode,
              payload: metadata,
              occurredAt,
            },
            { transaction },
          );
        }
        acceptedEvents += 1;
      }

      if (input.body.onDeviceMetrics.length > 0) {
        const run = await this.telemetryRepository.createOnDeviceRun(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            deviceId: input.body.deviceId,
            sessionId: input.body.sessionId,
            onboardingFlowId: flow ? String(flow.id) : null,
            integrityHash: sha256Hex(`${input.body.clientBatchId}:${input.idempotencyKey}`),
            computedAt: new Date(input.body.onDeviceMetrics[0]?.computedAt ?? input.body.capturedUntil),
          },
          { transaction },
        );
        for (const metric of input.body.onDeviceMetrics) {
          await this.telemetryRepository.createOnDeviceMetric(
            {
              tenantId: input.tenantId,
              computationRunId: String(run.id),
              metricCode: metric.metricCode,
              value: metric.value,
              confidenceScore: metric.confidenceScore === undefined ? null : metric.confidenceScore.toFixed(4),
              createdAt: now,
            },
            { transaction },
          );
          acceptedMetrics += 1;
        }
      }

      await this.telemetryRepository.createBehaviorSummary(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          onboardingFlowId: flow ? String(flow.id) : null,
          formEventCount,
          permissionEventCount,
          computedAt: now,
        },
        { transaction },
      );
      await this.telemetryRepository.upsertActivitySummary(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          deviceId: input.body.deviceId,
          eventCount: acceptedEvents,
          now,
        },
        { transaction },
      );
      await this.telemetryRepository.createAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actorPlatformUserId: input.currentUser.platformUserId ?? null,
          actionCode: 'customer_telemetry.batch_ingested',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          payload: {
            clientBatchId: input.body.clientBatchId,
            idempotencyKeyHash: sha256Hex(input.idempotencyKey),
            acceptedEvents,
            acceptedMetrics,
          },
          occurredAt: now,
        },
        { transaction },
      );
    });

    return {
      batchId: input.body.clientBatchId,
      acceptedEvents,
      acceptedMetrics,
      duplicatesIgnored: 0,
      status: 'accepted',
    };
  }
}
