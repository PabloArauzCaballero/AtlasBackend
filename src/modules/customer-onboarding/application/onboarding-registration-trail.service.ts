/**
 * @file Servicio de aplicación: flujo de onboarding, permisos, bitácora/auditoría y consentimientos del alta.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { ConsentsRepository } from '../../consents/consents.repository.js';
import { consentHappenedAt } from '../../consents/consent-time.util.js';
import type { CustomersRepository } from '../../customers/customers.repository.js';
import type { SessionsDeviceRepository } from '../../sessions/repositories/sessions-device.repository.js';
import type { SessionsLifecycleRepository } from '../../sessions/repositories/sessions-lifecycle.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import type { RegistrationCommand } from './ports/onboarding-registration.port.js';

type RegistrationInput = RegistrationCommand['registration'];

/** El rastro del alta: flujo, permisos, bitácora, auditoría y consentimientos, en la misma transacción. */
@Injectable()
export class OnboardingRegistrationTrailService {
  constructor(
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly consentsRepository: ConsentsRepository,
  ) {}

  // 5 + 6 + 7. Resolve global device fingerprint, tenant-scoped device, y customer-device link.
  // 10. Create onboarding flow and first step event.
  async createOnboardingFlowAndFirstEvent(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsLifecycleRepository['createSession']>>;
    input: RegistrationInput;
    sourceType: string;
    phoneHash: string | null;
    emailHash: string | null;
    now: Date;
    transaction: Transaction;
  }) {
    const onboardingFlow = await this.onboardingRepository.createOnboardingFlow(
      {
        tenantId: input.tenantId,
        customerId: String(input.customer.id),
        sessionId: String(input.session.id),
        flowVersion: 'v1',
        startedAt: input.now,
        completionStatus: 'in_progress',
      },
      { transaction: input.transaction },
    );

    await this.onboardingRepository.createOnboardingStepEvent(
      {
        tenantId: input.tenantId,
        onboardingFlowId: String(onboardingFlow.id),
        stepCode: input.input.onboarding?.startedStepCode ?? 'registration_started',
        eventType: 'started',
        happenedAt: input.now,
        payloadJson: {
          sourceType: input.sourceType,
          channel: input.input.device.channel,
          hasPhone: input.phoneHash !== null,
          hasEmail: input.emailHash !== null,
          consentCount: input.input.consents.length,
        },
      },
      { transaction: input.transaction },
    );

    return onboardingFlow;
  }

  // 11. Capture permission decisions as append-only events.
  /**
   * Agrupa el rastro del alta: permisos concedidos, bitácora de acción + auditoría operativa y
   * consentimientos. Van juntos porque los tres describen lo mismo desde ángulos distintos y
   * ninguno tiene sentido sin los otros dos en el expediente.
   */
  async recordDecisionsAndAudit(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsLifecycleRepository['createSession']>>;
    device: Awaited<ReturnType<SessionsDeviceRepository['findDevice']>>;
    onboardingFlow: Awaited<ReturnType<CustomerOnboardingRepository['createOnboardingFlow']>>;
    input: RegistrationInput;
    ipAddress: string | null;
    idempotencyKey: string;
    sourceType: string;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    await this.recordPermissionDecisions(input);
    await this.recordActionAndAuditLogs(input);
    await this.recordConsents(input);
  }

  async recordPermissionDecisions(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsLifecycleRepository['createSession']>>;
    onboardingFlow: Awaited<ReturnType<CustomerOnboardingRepository['createOnboardingFlow']>>;
    input: RegistrationInput;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    for (const permissionInput of input.input.permissions ?? []) {
      const decidedAt = permissionInput.decidedAt ? new Date(permissionInput.decidedAt) : input.now;
      await this.onboardingRepository.createPermissionEvent(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          sessionId: String(input.session.id),
          onboardingFlowId: String(input.onboardingFlow.id),
          permissionCode: permissionInput.permissionCode,
          granted: permissionInput.granted,
          decidedAt,
        },
        { transaction: input.transaction },
      );
    }
  }

  // 12. Register customer-level action and operational audit events.
  async recordActionAndAuditLogs(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsLifecycleRepository['createSession']>>;
    device: Awaited<ReturnType<SessionsDeviceRepository['findDevice']>>;
    onboardingFlow: Awaited<ReturnType<CustomerOnboardingRepository['createOnboardingFlow']>>;
    input: RegistrationInput;
    ipAddress: string | null;
    idempotencyKey: string;
    sourceType: string;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    await this.onboardingRepository.createCustomerActionLog(
      {
        tenantId: input.tenantId,
        customerId: String(input.customer.id),
        sessionId: String(input.session.id),
        deviceId: String(input.device!.id),
        eventName: 'customer_onboarding_started',
        screenName: 'onboarding_start',
        payloadJson: {
          sourceType: input.sourceType,
          channel: input.input.device.channel,
          idempotencyKeyHash: sha256Hex(input.idempotencyKey),
        },
        occurredAt: input.now,
      },
      { transaction: input.transaction },
    );

    await this.onboardingRepository.createOperationalAuditLog(
      {
        tenantId: input.tenantId,
        actorType: 'customer',
        actionCode: 'customer_onboarding.start',
        targetType: 'customer',
        targetId: String(input.customer.id),
        ipAddress: input.ipAddress,
        userAgent: input.input.device.userAgent ?? null,
        payloadJson: {
          onboardingFlowId: String(input.onboardingFlow.id),
          sessionId: String(input.session.id),
          deviceId: String(input.device!.id),
          idempotencyKeyHash: sha256Hex(input.idempotencyKey),
        },
        occurredAt: input.now,
      },
      { transaction: input.transaction },
    );
  }

  // 13. Record consents and consent events.
  async recordConsents(input: {
    tenantId: string;
    customer: Awaited<ReturnType<CustomersRepository['createCustomer']>>;
    session: Awaited<ReturnType<SessionsLifecycleRepository['createSession']>>;
    input: RegistrationInput;
    ipAddress: string | null;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    for (const consentInput of input.input.consents) {
      const happenedAt = consentHappenedAt(consentInput.acceptedAt, input.now);

      const consent = await this.consentsRepository.createCustomerConsent(
        {
          tenantId: input.tenantId,
          customerId: String(input.customer.id),
          consentDocumentId: consentInput.consentDocumentId,
          purposeCode: consentInput.purposeCode,
          granted: consentInput.granted,
          channel: input.input.device.channel,
          sessionId: String(input.session.id),
          ipAddress: input.ipAddress,
          deviceFingerprintSnapshot: input.input.device.deviceFingerprintHash,
          userAgent: input.input.device.userAgent ?? null,
          evidenceSnapshotUrl: null,
          happenedAt,
        },
        { transaction: input.transaction },
      );

      await this.consentsRepository.createConsentEvent(
        {
          tenantId: input.tenantId,
          customerConsentId: String(consent.id),
          eventType: consentInput.granted ? 'granted' : 'declined',
          channel: input.input.device.channel,
          sessionId: String(input.session.id),
          ipAddress: input.ipAddress,
          deviceFingerprintSnapshot: input.input.device.deviceFingerprintHash,
          triggeredByType: 'customer',
          triggeredByInternalUserId: null,
          notes: 'Consentimiento registrado durante onboarding inicial.',
          happenedAt,
        },
        { transaction: input.transaction },
      );
    }
  }
}
