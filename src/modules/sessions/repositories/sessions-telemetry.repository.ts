import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import {
  AuthEventModel,
  CustomerActionLogModel,
  CustomerObservationModel,
  IpReputationObservationModel,
  PermissionEventModel,
  SimObservationModel,
} from '../../../database/models/index.js';

export type RepositoryOptions = {
  transaction?: Transaction;
};

/**
 * ATLAS-P11-T12: parte de la descomposición de `sessions.repository.ts`. Responsabilidad única:
 * señales de telemetría de sesión de bajo nivel (permisos, auth events, reputación de IP, SIM,
 * acciones y observaciones de cliente). Split mecánico, sin cambio de comportamiento.
 */
@Injectable()
export class SessionsTelemetryRepository {
  constructor(
    @InjectModel(PermissionEventModel) private readonly permissionEventModel: typeof PermissionEventModel,
    @InjectModel(AuthEventModel) private readonly authEventModel: typeof AuthEventModel,
    @InjectModel(IpReputationObservationModel) private readonly ipReputationObservationModel: typeof IpReputationObservationModel,
    @InjectModel(SimObservationModel) private readonly simObservationModel: typeof SimObservationModel,
    @InjectModel(CustomerActionLogModel) private readonly customerActionLogModel: typeof CustomerActionLogModel,
    @InjectModel(CustomerObservationModel) private readonly customerObservationModel: typeof CustomerObservationModel,
  ) {}

  createPermissionEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
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

  findSessionPermissionEvents(tenantId: string, sessionId: string, limit = 20): Promise<PermissionEventModel[]> {
    return this.permissionEventModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['respondedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  createAuthEvent(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
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

  findSessionAuthEvents(tenantId: string, sessionId: string, limit = 20): Promise<AuthEventModel[]> {
    return this.authEventModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  createIpReputation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      ipAddress: string | null;
      isVpn: boolean | null;
      isProxy: boolean | null;
      isTor: boolean | null;
      countryCode: string | null;
      city: string | null;
      reputationScore: string | null;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<IpReputationObservationModel> {
    return this.ipReputationObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        providerRequestId: null,
        ipAddress: values.ipAddress,
        isVpn: values.isVpn,
        isProxy: values.isProxy,
        isTor: values.isTor,
        countryCode: values.countryCode,
        city: values.city,
        reputationScore: values.reputationScore,
        capturedAt: values.capturedAt,
        createdAtValue: values.capturedAt,
      },
      { transaction: options.transaction },
    );
  }

  findSessionIpReputation(tenantId: string, sessionId: string, limit = 10): Promise<IpReputationObservationModel[]> {
    return this.ipReputationObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  createSimObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string;
      phoneNumberHash: string | null;
      phoneLast4: string | null;
      carrierName: string | null;
      simType: string | null;
      simCount: number | null;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<SimObservationModel> {
    return this.simObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        phoneNumberHash: values.phoneNumberHash,
        phoneLast4: values.phoneLast4,
        carrierName: values.carrierName,
        simType: values.simType,
        simCount: values.simCount,
        phoneLineTenureMonths: null,
        lastSimSwapAt: null,
        simSwapDaysSince: null,
        sourceType: 'mobile_app',
        confidenceScore: null,
        capturedAt: values.capturedAt,
        createdAtValue: values.capturedAt,
      },
      { transaction: options.transaction },
    );
  }

  findSessionSimObservations(tenantId: string, sessionId: string, limit = 10): Promise<SimObservationModel[]> {
    return this.simObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  createCustomerAction(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string | null;
      eventName: string;
      screenName: string | null;
      payload: Record<string, unknown> | null;
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
        actionPayloadJson: values.payload,
        occurredAt: values.occurredAt,
        createdAtValue: values.occurredAt,
      },
      { transaction: options.transaction },
    );
  }

  findSessionCustomerActions(tenantId: string, sessionId: string, limit = 30): Promise<CustomerActionLogModel[]> {
    return this.customerActionLogModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['occurredAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }

  createCustomerObservation(
    values: {
      tenantId: string;
      customerId: string;
      sessionId: string;
      deviceId: string | null;
      observationCode: string;
      valueBoolean: boolean | null;
      payload: Record<string, unknown> | null;
      sourceType: string;
      capturedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerObservationModel> {
    return this.customerObservationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        sessionId: values.sessionId,
        deviceId: values.deviceId,
        observationCode: values.observationCode,
        valueText: null,
        valueNumber: null,
        valueBoolean: values.valueBoolean,
        valueJson: values.payload,
        sourceType: values.sourceType,
        sourceProviderId: null,
        evidenceId: null,
        confidenceScore: null,
        verificationStatus: 'observed',
        capturedAt: values.capturedAt,
        validFrom: values.capturedAt,
        validUntil: null,
        derivationMethod: null,
        derivationVersion: null,
        createdAtValue: values.capturedAt,
      },
      { transaction: options.transaction },
    );
  }

  findSessionCustomerObservations(tenantId: string, sessionId: string, limit = 30): Promise<CustomerObservationModel[]> {
    return this.customerObservationModel.findAll({
      where: { tenantId, sessionId },
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
    } as FindOptions);
  }
}
