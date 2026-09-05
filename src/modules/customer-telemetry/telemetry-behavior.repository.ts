/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system persiste una familia de señales de telemetría del cliente.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import {
  FormFieldInteractionEventModel,
  OnboardingBehaviorSummaryModel,
  OnboardingStepEventModel,
  PermissionEventModel,
} from '../../database/models/index.js';
import type { RepositoryOptions } from './telemetry-repository-options.js';

/**
 * Comportamiento durante el registro: cómo se llenó cada campo, qué permisos concedió, cuánto tardó
 * cada paso y el resumen agregado del flujo. Es la materia prima con la que se distingue a una
 * persona de un script.
 */
@Injectable()
export class TelemetryBehaviorRepository {
  constructor(
    @InjectModel(FormFieldInteractionEventModel)
    private readonly formFieldInteractionEventModel: typeof FormFieldInteractionEventModel,
    @InjectModel(PermissionEventModel)
    private readonly permissionEventModel: typeof PermissionEventModel,
    @InjectModel(OnboardingStepEventModel)
    private readonly onboardingStepEventModel: typeof OnboardingStepEventModel,
    @InjectModel(OnboardingBehaviorSummaryModel)
    private readonly onboardingBehaviorSummaryModel: typeof OnboardingBehaviorSummaryModel,
  ) {}

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
    return this.formFieldInteractionEventModel.create(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        fieldCode: values.fieldCode,
        interactionType: values.interactionType,
        usedCopyPaste: values.usedCopyPaste,
        correctionCount: values.correctionCount,
        focusDurationMs: values.focusDurationMs,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
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
    return this.permissionEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        onboardingFlowId: values.onboardingFlowId,
        permissionCode: values.permissionCode,
        requestedAt: values.occurredAt,
        granted: values.granted,
        respondedAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
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
    return this.onboardingStepEventModel.create(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        stepCode: values.stepCode,
        eventType: values.eventType,
        startedAt: values.occurredAt,
        endedAt: null,
        durationMs: null,
        errorCount: 0,
        payloadJson: values.payload,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
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
    return this.onboardingBehaviorSummaryModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        onboardingFlowId: values.onboardingFlowId,
        completionTimeSeconds: null,
        interScreenTimingJson: null,
        formErrorRate: null,
        ciCopyPasteDetected: null,
        abandonmentCountPrior: null,
        permissionGrantScore: values.permissionEventCount > 0 ? '1.0000' : null,
        behaviorClusterCode: null,
        botLikelihoodScore: null,
        computationVersion: 'telemetry-batch-v1',
        computedAt: values.computedAt,
        createdAtValue: values.computedAt,
      },
      { transaction: options.transaction },
    );
  }
}
