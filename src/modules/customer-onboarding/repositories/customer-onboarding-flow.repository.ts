import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import {
  AuthEventModel,
  CustomerActionLogModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  OperationalAuditLogModel,
  PermissionEventModel,
} from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `customer-onboarding.repository.ts` (era un único
 * archivo de 751 líneas con 20 modelos inyectados). Responsabilidad única: seguimiento del flujo
 * de onboarding (alta, pasos, permisos, acciones de cliente, auditoría operativa, eventos de
 * autenticación). Split mecánico, sin cambio de comportamiento ni de firmas públicas.
 */
@Injectable()
export class CustomerOnboardingFlowRepository {
  constructor(
    @InjectModel(OnboardingFlowModel) private readonly onboardingFlowModel: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel) private readonly onboardingStepEventModel: typeof OnboardingStepEventModel,
    @InjectModel(PermissionEventModel) private readonly permissionEventModel: typeof PermissionEventModel,
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(OperationalAuditLogModel) private readonly operationalAuditLogModel: typeof OperationalAuditLogModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
  ) {}

  createOnboardingFlow(
    values: { tenantId: string; customerId: string; sessionId: string; flowVersion: string; startedAt: Date; completionStatus: string },
    options: RepositoryOptions,
  ): Promise<OnboardingFlowModel> {
    return this.onboardingFlowModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        flowVersion: values.flowVersion,
        startedAt: values.startedAt,
        completedAt: null,
        abandonedAt: null,
        completionStatus: values.completionStatus,
        totalDurationSeconds: null,
        createdAtValue: values.startedAt,
      },
      { transaction: options.transaction },
    );
  }

  findLatestOnboardingFlow(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<OnboardingFlowModel | null> {
    return this.onboardingFlowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    } as import('sequelize').FindOptions);
  }

  createOnboardingStepEvent(
    values: {
      tenantId: string;
      onboardingFlowId: string | null;
      stepCode: string;
      eventType: string;
      happenedAt: Date;
      payloadJson: Record<string, unknown> | null;
    },
    options: RepositoryOptions,
  ): Promise<OnboardingStepEventModel> {
    return this.onboardingStepEventModel.create(
      {
        tenantId: values.tenantId,
        onboardingFlowId: values.onboardingFlowId,
        stepCode: values.stepCode,
        eventType: values.eventType,
        startedAt: values.happenedAt,
        endedAt: null,
        durationMs: null,
        errorCount: 0,
        payloadJson: values.payloadJson,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  createPermissionEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      onboardingFlowId: string | null;
      permissionCode: string;
      granted: boolean;
      decidedAt: Date;
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
        requestedAt: values.decidedAt,
        granted: values.granted,
        respondedAt: values.decidedAt,
        createdAtValue: values.decidedAt,
      },
      { transaction: options.transaction },
    );
  }

  createCustomerActionLog(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      eventName: string;
      screenName: string | null;
      payloadJson: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerActionLogModel> {
    return this.customerActionLogModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        eventName: values.eventName,
        screenName: values.screenName,
        actionPayloadJson: values.payloadJson,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createOperationalAuditLog(
    values: {
      tenantId: string;
      actorType: string;
      actorInternalUserId?: string | null;
      actionCode: string;
      targetType: string;
      targetId: string;
      ipAddress: string | null;
      userAgent: string | null;
      payloadJson: Record<string, unknown> | null;
      occurredAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<OperationalAuditLogModel> {
    return this.operationalAuditLogModel.create(
      {
        tenantId: values.tenantId,
        actorType: values.actorType,
        actorInternalUserId: values.actorInternalUserId ?? null,
        actorPlatformUserId: null,
        actionCode: values.actionCode,
        targetType: values.targetType,
        targetId: values.targetId,
        ipAddress: values.ipAddress,
        userAgent: values.userAgent,
        payloadJson: values.payloadJson,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  createAuthEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string | null;
      deviceId: string | null;
      eventType: string;
      loginSuccessful: boolean | null;
      failureReasonCode: string | null;
      occurredAt: Date;
      ipAddress: string | null;
    },
    options: RepositoryOptions,
  ): Promise<AuthEventModel> {
    return this.authEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        eventType: values.eventType,
        loginSuccessful: values.loginSuccessful,
        failureReasonCode: values.failureReasonCode,
        occurredAt: values.occurredAt,
        ipAddress: values.ipAddress,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }
}
