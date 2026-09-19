/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system reparte cada familia de señales en su repositorio y conserva un único punto de entrada.
 */
import { Injectable } from '@nestjs/common';
import {
  AuthEventModel,
  CustomerActionLogModel,
  CustomerDeviceLinkModel,
  CustomerObservationModel,
  CustomerSessionModel,
  DeviceRiskEventModel,
  FormFieldInteractionEventModel,
  IpReputationObservationModel,
  OnDeviceComputationRunModel,
  OnDeviceMetricValueModel,
  OnboardingBehaviorSummaryModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
  PermissionEventModel,
  SimObservationModel,
} from '../../database/models/index.js';
import { TelemetrySessionContextRepository } from './telemetry-session-context.repository.js';
import { TelemetryBehaviorRepository } from './telemetry-behavior.repository.js';
import { TelemetryDeviceSignalsRepository } from './telemetry-device-signals.repository.js';
import { TelemetryOnDeviceRepository } from './telemetry-on-device.repository.js';
import { TelemetryActivityRepository } from './telemetry-activity.repository.js';
import type { RepositoryOptions } from './telemetry-repository-options.js';

export type { RepositoryOptions } from './telemetry-repository-options.js';

/**
 * Fachada de la persistencia de telemetría.
 *
 * Era un único archivo de 563 líneas con 17 modelos inyectados, y mezclaba cinco cosas que solo
 * comparten el hecho de llegar en el mismo lote: el contexto al que se cuelga la señal, el
 * comportamiento durante el registro, las señales de riesgo del aparato y de la red, lo que se
 * calculó en el propio teléfono, y la actividad del cliente con su auditoría. Cada una tiene ahora
 * su repositorio; ningún método público cambió de firma, así que el servicio de ingesta no se toca.
 */
@Injectable()
export class CustomerTelemetryRepository {
  constructor(
    private readonly sessionContext: TelemetrySessionContextRepository,
    private readonly behavior: TelemetryBehaviorRepository,
    private readonly deviceSignals: TelemetryDeviceSignalsRepository,
    private readonly onDevice: TelemetryOnDeviceRepository,
    private readonly activity: TelemetryActivityRepository,
  ) {}

  findCustomerDeviceLink(tenantId: string, customerId: string, deviceId: string): Promise<CustomerDeviceLinkModel | null> {
    return this.sessionContext.findCustomerDeviceLink(tenantId, customerId, deviceId);
  }

  findCustomerSession(tenantId: string, customerId: string, sessionId: string): Promise<CustomerSessionModel | null> {
    return this.sessionContext.findCustomerSession(tenantId, customerId, sessionId);
  }

  findLatestOnboardingFlow(tenantId: string, customerId: string): Promise<OnboardingFlowModel | null> {
    return this.sessionContext.findLatestOnboardingFlow(tenantId, customerId);
  }

  createFormFieldEvent(
    values: {
      tenantId: string;
      onboardingFlowId: string | null;
      fieldCode: string;
      interactionType: string;
      usedCopyPaste: boolean | null;
      correctionCount: number | null;
      focusDurationMs: number | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<FormFieldInteractionEventModel> {
    return this.behavior.createFormFieldEvent(values, options);
  }

  createPermissionEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      onboardingFlowId: string | null;
      permissionCode: string;
      granted: boolean;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<PermissionEventModel> {
    return this.behavior.createPermissionEvent(values, options);
  }

  createOnboardingStepEvent(
    values: {
      tenantId: string;
      onboardingFlowId: string | null;
      stepCode: string;
      eventType: string;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnboardingStepEventModel> {
    return this.behavior.createOnboardingStepEvent(values, options);
  }

  createBehaviorSummary(
    values: {
      tenantId: string;
      customerId: string;
      onboardingFlowId: string | null;
      formEventCount: number;
      permissionEventCount: number;
      computedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnboardingBehaviorSummaryModel> {
    return this.behavior.createBehaviorSummary(values, options);
  }

  createAuthEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      eventType: string;
      loginSuccessful: boolean | null;
      failureReasonCode: string | null;
      occurredAt: Date;
      ipAddress: string | null;
    },
    options: RepositoryOptions,
  ): Promise<AuthEventModel> {
    return this.deviceSignals.createAuthEvent(values, options);
  }

  createDeviceRiskEvent(
    values: {
      tenantId: string;
      deviceId: string;
      eventType: string;
      reasonCode: string | null;
      evidence: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<DeviceRiskEventModel> {
    return this.deviceSignals.createDeviceRiskEvent(values, options);
  }

  createSimObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      metadata: Record<string, unknown>;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<SimObservationModel> {
    return this.deviceSignals.createSimObservation(values, options);
  }

  createIpReputation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      ipAddress: string | null;
      metadata: Record<string, unknown>;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<IpReputationObservationModel> {
    return this.deviceSignals.createIpReputation(values, options);
  }

  createOnDeviceRun(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      sessionId: string;
      onboardingFlowId: string | null;
      integrityHash: string;
      computedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnDeviceComputationRunModel> {
    return this.onDevice.createOnDeviceRun(values, options);
  }

  createOnDeviceMetric(
    values: {
      tenantId: string;
      computationRunId: string;
      metricCode: string;
      value: string | number | boolean | Record<string, unknown>;
      confidenceScore: string | null;
      createdAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OnDeviceMetricValueModel> {
    return this.onDevice.createOnDeviceMetric(values, options);
  }

  createOnDeviceMetrics(
    values: Array<{
      tenantId: string;
      computationRunId: string;
      metricCode: string;
      value: string | number | boolean | Record<string, unknown>;
      confidenceScore: string | null;
      createdAt: Date;
    }>,
    options: RepositoryOptions,
  ): Promise<OnDeviceMetricValueModel[]> {
    return this.onDevice.createOnDeviceMetrics(values, options);
  }

  createCustomerAction(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      eventName: string;
      screenName: string | null;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerActionLogModel> {
    return this.activity.createCustomerAction(values, options);
  }

  createCustomerObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      observationCode: string;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerObservationModel> {
    return this.activity.createCustomerObservation(values, options);
  }

  async upsertActivitySummary(
    values: {
      tenantId: string;
      customerId: string;
      deviceId: string;
      eventCount: number;
      now: Date;
    },
    options: RepositoryOptions,
  ): Promise<void> {
    return this.activity.upsertActivitySummary(values, options);
  }

  createAudit(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId: string | null;
      actorPlatformUserId: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      ipAddress: string | null;
      payload: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OperationalAuditLogModel> {
    return this.activity.createAudit(values, options);
  }
}
